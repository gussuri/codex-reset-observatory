import { LOCAL_OPENAI_STATUS_HISTORY } from "@/data/statusHistory";
import type {
  CodexOperationalStatus,
  DataFetchResult,
  DataSourceDetail,
} from "@/lib/radar/types";

const OPENAI_STATUS_SUMMARY_URL =
  "https://status.openai.com/api/v2/summary.json";
const OPENAI_STATUS_INCIDENTS_URL =
  "https://status.openai.com/api/v2/incidents.json";

const FETCH_TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CODEX_RECOVERY_WINDOW_MS = 2 * 60 * 60 * 1000;
const STATUS_INCIDENT_URL_BASE = "https://status.openai.com/incidents";

type StatuspageComponent = {
  id?: string;
  name?: string;
  status?: string;
  updated_at?: string;
};

type StatuspageIncident = {
  id?: string;
  name?: string;
  status?: string;
  impact?: string;
  created_at?: string;
  updated_at?: string;
  resolved_at?: string | null;
  incident_updates?: Array<{
    body?: string;
    status?: string;
    created_at?: string;
    updated_at?: string;
  }>;
};

type StatusSummaryResponse = {
  page?: {
    updated_at?: string;
  };
  status?: {
    indicator?: string;
  };
  components?: Array<StatuspageComponent>;
};

type StatusIncidentsResponse = {
  page?: {
    updated_at?: string;
  };
  incidents?: Array<StatuspageIncident>;
};

export type OpenAIStatusSignals = {
  updatedAt: string | null;
  statusIncidents24h: number;
  activeCodexIncidents: number;
  recentCodexIncidents: number;
  affectedCodexComponents: number;
  suppressCodexIncidents: boolean;
  codexOperationalStatus: CodexOperationalStatus;
  latestCodexIncidentName: string | null;
  history: Array<OpenAIStatusHistoryItem>;
};

export type OpenAIStatusHistoryItem = {
  id: string;
  title: string;
  status: string;
  impact: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  resolvedAt: string | null;
  source: "openai_status";
  url: string;
};

type FetchOptions = {
  cache?: RequestCache;
  revalidate?: number;
};

export async function fetchOpenAIStatusSignals(
  options: FetchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<DataFetchResult<OpenAIStatusSignals>> {
  const [summaryResult, incidentsResult] = await Promise.allSettled([
    fetchStatusJson<StatusSummaryResponse>(
      OPENAI_STATUS_SUMMARY_URL,
      options,
      fetchImpl,
      isStatusSummaryResponse,
    ),
    fetchStatusJson<StatusIncidentsResponse>(
      OPENAI_STATUS_INCIDENTS_URL,
      options,
      fetchImpl,
      isStatusIncidentsResponse,
    ),
  ]);

  const summary = summaryResult.status === "fulfilled" ? summaryResult.value : {
    data: null,
    failure: "request_failed" as const,
  };
  const incidents = incidentsResult.status === "fulfilled" ? incidentsResult.value : {
    data: null,
    failure: "request_failed" as const,
  };

  if (!summary.data && !incidents.data) {
    return {
      data: getStoredStatusSignals(),
      health: {
        state: "degraded",
        detail: getStatusFailureDetail(summary.failure, incidents.failure),
      },
    };
  }

  const codexComponents =
    summary.data?.components?.filter((component) => isCodexText(component.name)) ??
    [];
  const coreCodexComponents = codexComponents.filter((component) =>
    isCoreCodexComponent(component.name),
  );
  const hostIntegrationComponents = codexComponents.filter((component) =>
    isHostIntegrationComponent(component.name),
  );

  const affectedCoreCodexComponents = coreCodexComponents.filter(
    (component) =>
      component.status && component.status !== "operational",
  ).length;

  const codexIncidents =
    incidents.data?.incidents?.filter((incident) => isCodexIncident(incident)) ?? [];
  const activeCodexIncidents = codexIncidents.filter(
    (incident) => !isResolvedIncident(incident),
  );
  const recentCodexIncidents = codexIncidents.filter((incident) =>
    isRecentIncident(incident),
  );

  const hasCoreComponentData = coreCodexComponents.length > 0;
  const affectedIntegrationComponents = hostIntegrationComponents.filter(
    (component) =>
      component.status && component.status !== "operational",
  ).length;

  // An integration component (e.g. Codex in ChatGPT Desktop) only counts as an
  // affected Codex component if there is an active Codex incident.
  const affectedCodexComponents =
    affectedCoreCodexComponents +
    (activeCodexIncidents.length > 0 ? affectedIntegrationComponents : 0);

  // Codex コアコンポーネント（Codex Web / Codex API 等）がすべて operational の場合は
  // インシデント文言による誤検知を防ぐためインシデント警告を抑制する
  const allCodexComponentsOperational = hasCoreComponentData
    ? affectedCoreCodexComponents === 0
    : affectedCodexComponents === 0;

  const codexOperationalStatus = getCodexOperationalStatus({
    codexComponents,
    codexIncidents,
    incidentsAvailable: Boolean(incidents.data),
    summaryAvailable: Boolean(summary.data),
  });
  const incidentIds = new Set<string>();

  for (const incident of [...activeCodexIncidents, ...recentCodexIncidents]) {
    incidentIds.add(incident.id ?? incident.name ?? "");
  }

  incidentIds.delete("");

  const latestCodexIncident = [...codexIncidents].sort(
    (a, b) => getIncidentTime(b) - getIncidentTime(a),
  )[0];
  const history = mergeStatusHistory(
    codexIncidents.map(normalizeStatusIncident),
  );
  const updatedAt = getLatestIsoDate([
    summary.data?.page?.updated_at,
    incidents.data?.page?.updated_at,
    latestCodexIncident?.updated_at,
    latestCodexIncident?.resolved_at,
    latestCodexIncident?.created_at,
  ]);

  return {
    data: {
      updatedAt,
      // コンポーネントが全部正常なら incidents は 0 扱い（誤検知防止）
      statusIncidents24h: allCodexComponentsOperational
        ? 0
        : incidentIds.size + affectedCodexComponents,
      activeCodexIncidents: allCodexComponentsOperational
        ? 0
        : activeCodexIncidents.length,
      recentCodexIncidents: recentCodexIncidents.length,
      affectedCodexComponents,
      suppressCodexIncidents: allCodexComponentsOperational,
      codexOperationalStatus,
      latestCodexIncidentName: latestCodexIncident?.name ?? null,
      history,
    },
    health:
      summary.data && incidents.data
        ? { state: "ok" }
        : { state: "degraded", detail: "partial_response" },
  };
}

function getStoredStatusSignals(): OpenAIStatusSignals {
  const latestStoredIncident = LOCAL_OPENAI_STATUS_HISTORY[0];

  return {
    updatedAt:
      getLatestIsoDate(
        LOCAL_OPENAI_STATUS_HISTORY.flatMap((item) => [
          item.updatedAt,
          item.resolvedAt,
          item.createdAt,
        ]),
      ) ?? null,
    statusIncidents24h: 0,
    activeCodexIncidents: 0,
    recentCodexIncidents: 0,
    affectedCodexComponents: 0,
    suppressCodexIncidents: false,
    codexOperationalStatus: "unknown",
    latestCodexIncidentName: latestStoredIncident?.title ?? null,
    history: LOCAL_OPENAI_STATUS_HISTORY,
  };
}

type StatusFetchResult<T> = {
  data: T | null;
  failure?: Extract<DataSourceDetail, "request_failed" | "invalid_response">;
};

async function fetchStatusJson<T>(
  url: string,
  options: FetchOptions,
  fetchImpl: typeof fetch,
  isValidResponse: (value: unknown) => value is T,
): Promise<StatusFetchResult<T>> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let response: Response;
    try {
      response = await fetchImpl(url, {
        headers: {
          accept: "application/json",
        },
        cache: options.cache,
        next:
          typeof options.revalidate === "number"
            ? { revalidate: options.revalidate }
            : undefined,
        signal: controller.signal,
      });
    } catch (error) {
      console.error(`OpenAI Status request failed for ${url}`, error);
      return { data: null, failure: "request_failed" };
    }

    if (!response.ok) {
      console.error(
        `OpenAI Status request returned ${response.status} for ${url}`,
      );
      return { data: null, failure: "request_failed" };
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      console.error(`OpenAI Status returned non-JSON content for ${url}`);
      return { data: null, failure: "invalid_response" };
    }

    let data: unknown;
    try {
      data = await response.json();
    } catch (error) {
      console.error(`OpenAI Status returned malformed JSON for ${url}`, error);
      return { data: null, failure: "invalid_response" };
    }

    if (!isValidResponse(data)) {
      console.error(`OpenAI Status returned malformed data for ${url}`);
      return { data: null, failure: "invalid_response" };
    }

    return { data };
  } finally {
    clearTimeout(timeoutId);
  }
}

function getStatusFailureDetail(
  ...failures: Array<StatusFetchResult<unknown>["failure"]>
): Extract<DataSourceDetail, "request_failed" | "invalid_response"> {
  return failures.includes("invalid_response")
    ? "invalid_response"
    : "request_failed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isStatusSummaryResponse(value: unknown): value is StatusSummaryResponse {
  return (
    isRecord(value) &&
    isRecord(value.page) &&
    (value.status === undefined || isRecord(value.status)) &&
    Array.isArray(value.components) &&
    value.components.every(isRecord)
  );
}

function isStatusIncidentsResponse(value: unknown): value is StatusIncidentsResponse {
  return (
    isRecord(value) &&
    isRecord(value.page) &&
    Array.isArray(value.incidents) &&
    value.incidents.every(isStatusIncident)
  );
}

function isStatusIncident(value: unknown): value is StatuspageIncident {
  return (
    isRecord(value) &&
    (value.incident_updates === undefined ||
      (Array.isArray(value.incident_updates) &&
        value.incident_updates.every(isRecord)))
  );
}

export function isHostIntegrationComponent(name: string | null | undefined): boolean {
  return Boolean(name && /\bin\s+chatgpt\b/i.test(name));
}

export function isCoreCodexComponent(name: string | null | undefined): boolean {
  return isCodexText(name) && !isHostIntegrationComponent(name);
}

export function hasAffirmativeCodexImpact(text: string): boolean {
  if (!isCodexText(text)) return false;

  const isExplicitlyNegated =
    /\bcodex\b[^.!?\n]{0,60}\b(?:is\s+not\s+(?:affected|impacted)|remains\s+operational|operating\s+normally|is\s+unaffected|not\s+impacted)\b/i.test(text) ||
    /\b(?:does\s+not|not)\s+(?:affect|impact)\s+codex\b/i.test(text) ||
    /\b(?:no|without)\s+impact\s+(?:to|on)\s+codex\b/i.test(text) ||
    /\bcodex\b[^.!?\n]{0,40}\b(?:is\s+operational|unaffected)\b/i.test(text);

  if (isExplicitlyNegated) {
    const sentences = text.split(/(?<=[.!?\n])\s+/);
    return sentences.some((sentence) => {
      const sentenceNegated =
        /\bcodex\b[^.!?\n]{0,60}\b(?:is\s+not\s+(?:affected|impacted)|remains\s+operational|operating\s+normally|is\s+unaffected|not\s+impacted)\b/i.test(sentence) ||
        /\b(?:does\s+not|not)\s+(?:affect|impact)\s+codex\b/i.test(sentence) ||
        /\b(?:no|without)\s+impact\s+(?:to|on)\s+codex\b/i.test(sentence) ||
        /\bcodex\b[^.!?\n]{0,40}\b(?:is\s+operational|unaffected)\b/i.test(sentence);
      if (sentenceNegated) return false;

      return (
        /\bcodex\b[^.!?\n]{0,80}\b(?:users?\s+(?:are|may\s+be)\s+experiencing|is\s+(?:experiencing|down|degraded|disrupted|failing|unresponsive)|errors?|issues?|outage|disruption|latency)\b/i.test(sentence) ||
        /\b(?:elevated|increased|higher)\s+(?:error\s+rates?|errors?|latency)\b[^.!?\n]{0,80}\b(?:in|on|with|for)\s+codex\b/i.test(sentence) ||
        /\b(?:affecting|affects?|impacts?|impacting)\s+codex\b/i.test(sentence) ||
        /\bissues?\s+with\s+codex\b/i.test(sentence)
      );
    });
  }

  return (
    /\bcodex\b[^.!?\n]{0,80}\b(?:users?\s+(?:are|may\s+be)\s+experiencing|is\s+(?:experiencing|down|degraded|disrupted|failing|unresponsive)|errors?|issues?|outage|disruption|latency)\b/i.test(text) ||
    /\b(?:elevated|increased|higher)\s+(?:error\s+rates?|errors?|latency)\b[^.!?\n]{0,80}\b(?:in|on|with|for)\s+codex\b/i.test(text) ||
    /\b(?:affecting|affects?|impacts?|impacting)\s+codex\b/i.test(text) ||
    /\bissues?\s+with\s+codex\b/i.test(text)
  );
}

export function isCodexIncident(incident: StatuspageIncident): boolean {
  const name = incident.name ?? "";
  const updateBodies = (incident.incident_updates ?? [])
    .map((update) => update.body ?? "")
    .filter(Boolean);
  const fullText = [
    name,
    incident.impact,
    incident.status,
    ...updateBodies,
    ...(incident.incident_updates ?? []).map((update) => update.status ?? ""),
  ]
    .filter(Boolean)
    .join(" ");

  if (!isCodexText(fullText)) return false;

  // FedRAMP ワークスペース限定の障害は一般ユーザー向け Codex に影響しないため除外する
  const isFedRAMPOnly = /\bFedRAMP\b/i.test(fullText) && (
    /\bin FedRAMP workspaces?\b/i.test(fullText) ||
    /\bFedRAMP (environment|workspace|tenant)/i.test(fullText)
  );
  if (isFedRAMPOnly) return false;

  // Work-only or non-Codex product incident
  const isWorkOrNonCodexName =
    /\b(?:chatgpt\s+work|work\s+mode|scheduled\s+tasks?)\b/i.test(name) &&
    !isCodexText(name);

  if (isWorkOrNonCodexName) {
    // If the incident is explicitly scoped to Work / Work Mode, only consider it a Codex incident
    // if updates affirmatively state that Codex service itself is experiencing issues.
    return updateBodies.some((body) => hasAffirmativeCodexImpact(body));
  }

  // If incident title explicitly mentions Codex, confirm it is not an explicit exclusion
  if (isCodexText(name)) {
    const isExplicitlyNegated =
      /\b(?:does\s+not|not)\s+(?:affect|impact)\s+codex\b/i.test(name) ||
      /\bcodex\s+unaffected\b/i.test(name);
    return !isExplicitlyNegated;
  }

  // General or other incident without Codex in title: require affirmative Codex impact in updates
  return updateBodies.some((body) => hasAffirmativeCodexImpact(body));
}

export function getCodexOperationalStatus({
  codexComponents,
  codexIncidents,
  incidentsAvailable,
  summaryAvailable,
  now = new Date(),
}: {
  codexComponents: Array<StatuspageComponent>;
  codexIncidents: Array<StatuspageIncident>;
  incidentsAvailable: boolean;
  summaryAvailable: boolean;
  now?: Date;
}): CodexOperationalStatus {
  const activeIncidents = codexIncidents.filter(
    (incident) => !isResolvedIncident(incident),
  );
  const hasActiveIncident = activeIncidents.length > 0;

  const coreComponents = codexComponents.filter((component) =>
    isCoreCodexComponent(component.name),
  );
  const hasAffectedCoreComponent = coreComponents.some(
    (component) => component.status && component.status !== "operational",
  );
  if (hasAffectedCoreComponent) {
    return "active";
  }

  // If no explicitly recognized core components are present, check if any
  // non-host-integration Codex component is degraded
  const nonIntegrationComponents = codexComponents.filter(
    (component) => !isHostIntegrationComponent(component.name),
  );
  if (nonIntegrationComponents.some((c) => c.status && c.status !== "operational")) {
    return "active";
  }

  // An active, verified Codex incident means active status
  if (hasActiveIncident) {
    return "active";
  }

  // Host integration components (e.g. Codex in ChatGPT Desktop):
  // When core components are operational and there is no active Codex incident,
  // host client degradation (such as ChatGPT Desktop Work Mode errors) does not constitute a Codex service outage.
  const hasAffectedIntegrationComponent = codexComponents.some(
    (component) =>
      isHostIntegrationComponent(component.name) &&
      component.status &&
      component.status !== "operational",
  );
  if (hasAffectedIntegrationComponent && hasActiveIncident) {
    return "active";
  }

  const hasRecentResolution = codexIncidents.some((incident) => {
    const resolvedAt = getDateTime(incident.resolved_at);
    if (resolvedAt === 0) return false;

    const elapsed = now.getTime() - resolvedAt;
    return elapsed >= 0 && elapsed < CODEX_RECOVERY_WINDOW_MS;
  });
  if (hasRecentResolution) {
    return "recovered";
  }

  return incidentsAvailable && summaryAvailable ? "none" : "unknown";
}

function normalizeStatusIncident(
  incident: StatuspageIncident,
): OpenAIStatusHistoryItem {
  const id = incident.id ?? `openai-status-${incident.name ?? "unknown"}`;

  return {
    id,
    title: incident.name ?? "OpenAI Status incident",
    status: incident.status ?? "unknown",
    impact: incident.impact ?? null,
    createdAt: incident.created_at ?? null,
    updatedAt: incident.updated_at ?? null,
    resolvedAt: incident.resolved_at ?? null,
    source: "openai_status",
    url: `${STATUS_INCIDENT_URL_BASE}/${id}`,
  };
}

function mergeStatusHistory(
  fetchedHistory: Array<OpenAIStatusHistoryItem>,
) {
  const items = [...fetchedHistory, ...LOCAL_OPENAI_STATUS_HISTORY];
  const seen = new Set<string>();

  return items
    .filter((item) => {
      if (seen.has(item.id)) {
        return false;
      }

      seen.add(item.id);
      return true;
    })
    .sort((a, b) => getDateTime(b.createdAt) - getDateTime(a.createdAt));
}

function isCodexText(value: string | null | undefined) {
  return Boolean(value && /\bcodex\b/i.test(value));
}

function isResolvedIncident(incident: StatuspageIncident) {
  return Boolean(incident.resolved_at) || incident.status === "resolved";
}

function isRecentIncident(incident: StatuspageIncident) {
  const elapsed = Date.now() - getIncidentTime(incident);
  return elapsed >= 0 && elapsed <= DAY_MS;
}

function getIncidentTime(incident: StatuspageIncident) {
  return Math.max(
    getDateTime(incident.updated_at),
    getDateTime(incident.resolved_at),
    getDateTime(incident.created_at),
  );
}

function getLatestIsoDate(values: Array<string | null | undefined>) {
  const latest = values
    .map((value) => (value ? new Date(value) : null))
    .filter(
      (value): value is Date =>
        Boolean(value && !Number.isNaN(value.getTime())),
    )
    .sort((a, b) => b.getTime() - a.getTime())
    .at(0);

  return latest?.toISOString() ?? null;
}

function getDateTime(value: string | null | undefined) {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}
