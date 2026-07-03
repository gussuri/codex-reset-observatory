import { LOCAL_OPENAI_STATUS_HISTORY } from "@/data/statusHistory";

const OPENAI_STATUS_SUMMARY_URL =
  "https://status.openai.com/api/v2/summary.json";
const OPENAI_STATUS_INCIDENTS_URL =
  "https://status.openai.com/api/v2/incidents.json";

const FETCH_TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;
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
): Promise<OpenAIStatusSignals | null> {
  const [summaryResult, incidentsResult] = await Promise.allSettled([
    fetchStatusJson<StatusSummaryResponse>(OPENAI_STATUS_SUMMARY_URL, options),
    fetchStatusJson<StatusIncidentsResponse>(
      OPENAI_STATUS_INCIDENTS_URL,
      options,
    ),
  ]);

  const summary =
    summaryResult.status === "fulfilled" ? summaryResult.value : null;
  const incidents =
    incidentsResult.status === "fulfilled" ? incidentsResult.value : null;

  if (!summary && !incidents) {
    return getStoredStatusSignals();
  }

  const codexComponents =
    summary?.components?.filter((component) => isCodexText(component.name)) ??
    [];
  const hasCodexComponentData = codexComponents.length > 0;
  const affectedCodexComponents = codexComponents.filter(
    (component) =>
      component.status && component.status !== "operational",
  ).length;
  // Codex コンポーネント（Codex Web / Codex API 等）がすべて operational の場合は
  // インシデント文言による誤検知を防ぐためインシデント警告を抑制する
  const allCodexComponentsOperational =
    hasCodexComponentData && affectedCodexComponents === 0;

  const codexIncidents =
    incidents?.incidents?.filter((incident) => isCodexIncident(incident)) ?? [];
  const activeCodexIncidents = codexIncidents.filter(
    (incident) => !isResolvedIncident(incident),
  );
  const recentCodexIncidents = codexIncidents.filter((incident) =>
    isRecentIncident(incident),
  );
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
    summary?.page?.updated_at,
    incidents?.page?.updated_at,
    latestCodexIncident?.updated_at,
    latestCodexIncident?.resolved_at,
    latestCodexIncident?.created_at,
  ]);

  return {
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
    latestCodexIncidentName: latestCodexIncident?.name ?? null,
    history,
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
    latestCodexIncidentName: latestStoredIncident?.title ?? null,
    history: LOCAL_OPENAI_STATUS_HISTORY,
  };
}

async function fetchStatusJson<T>(url: string, options: FetchOptions) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
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

    if (!response.ok) {
      return null;
    }

    const contentType = response.headers.get("content-type");
    if (!contentType?.includes("application/json")) {
      return null;
    }

    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isCodexIncident(incident: StatuspageIncident) {
  const text = [
    incident.name,
    incident.impact,
    incident.status,
    ...(incident.incident_updates ?? []).flatMap((update) => [
      update.body,
      update.status,
    ]),
  ]
    .filter(Boolean)
    .join(" ");

  if (!isCodexText(text)) return false;

  // FedRAMP ワークスペース限定の障害は一般ユーザー向け Codex に影響しないため除外する
  const isFedRAMPOnly = /\bFedRAMP\b/i.test(text) && (
    /\bin FedRAMP workspaces?\b/i.test(text) ||
    /\bFedRAMP (environment|workspace|tenant)/i.test(text)
  );
  if (isFedRAMPOnly) return false;

  return true;
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
  return Date.now() - getIncidentTime(incident) <= DAY_MS;
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
