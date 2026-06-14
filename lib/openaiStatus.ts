const OPENAI_STATUS_SUMMARY_URL =
  "https://status.openai.com/api/v2/summary.json";
const OPENAI_STATUS_INCIDENTS_URL =
  "https://status.openai.com/api/v2/incidents.json";

const FETCH_TIMEOUT_MS = 8000;
const DAY_MS = 24 * 60 * 60 * 1000;

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
    return null;
  }

  const affectedCodexComponents =
    summary?.components?.filter(
      (component) =>
        isCodexText(component.name) &&
        component.status &&
        component.status !== "operational",
    ).length ?? 0;
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
  const updatedAt = getLatestIsoDate([
    summary?.page?.updated_at,
    incidents?.page?.updated_at,
    latestCodexIncident?.updated_at,
    latestCodexIncident?.resolved_at,
    latestCodexIncident?.created_at,
  ]);

  return {
    updatedAt,
    statusIncidents24h: incidentIds.size + affectedCodexComponents,
    activeCodexIncidents: activeCodexIncidents.length,
    recentCodexIncidents: recentCodexIncidents.length,
    affectedCodexComponents,
    latestCodexIncidentName: latestCodexIncident?.name ?? null,
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

  return isCodexText(text);
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
