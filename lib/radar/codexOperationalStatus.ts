export type TiboCodexOperationalStatus =
  | "none"
  | "investigating"
  | "active"
  | "recovered";

export type PublicCodexOperationalStatus = TiboCodexOperationalStatus | "unknown";

export type CodexOperationalAssessment = {
  status: TiboCodexOperationalStatus | null;
  confidence: number | null;
  evidenceQuote: string | null;
  reasonJa: string | null;
};

export type CodexOperationalDisplayResult = {
  status: PublicCodexOperationalStatus;
  source: "openai_status" | "tibo" | "combined" | "none";
  observedAt: string | null;
  expiresAt: string | null;
};

export type TiboOperationalSignalLike = {
  tweet_created_at?: string | null;
  verification_status?: string | null;
  codex_operational_status?: TiboCodexOperationalStatus | null;
  codex_operational_expires_at?: string | null;
};

export type OpenAIStatusHistoryLike = {
  status?: string | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  resolvedAt?: string | null;
};

export const TIBO_OPERATIONAL_TTL_MS = 12 * 60 * 60 * 1000;
export const OPENAI_RECOVERY_DISPLAY_TTL_MS = 12 * 60 * 60 * 1000;

const OPERATIONAL_STATUSES = new Set<TiboCodexOperationalStatus>([
  "none",
  "investigating",
  "active",
  "recovered",
]);

function emptyAssessment(): CodexOperationalAssessment {
  return {
    status: null,
    confidence: null,
    evidenceQuote: null,
    reasonJa: null,
  };
}

function isOperationalStatus(value: unknown): value is TiboCodexOperationalStatus {
  return typeof value === "string" && OPERATIONAL_STATUSES.has(value as TiboCodexOperationalStatus);
}

function normalizeEvidenceQuote(value: unknown, authorText: string) {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string" || value.length > 300) return undefined;

  const quote = value.trim();
  if (!quote) return null;
  if (!authorText.toLowerCase().includes(quote.toLowerCase())) return undefined;
  return quote;
}

function timestamp(value: string | null | undefined) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseCodexOperationalAssessment(
  value: Record<string, unknown> | null | undefined,
  authorText: string,
): CodexOperationalAssessment {
  if (!value || !isOperationalStatus(value.codexOperationalStatus)) {
    return emptyAssessment();
  }

  const confidence = value.codexOperationalConfidence;
  if (
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return emptyAssessment();
  }

  const evidenceQuote = normalizeEvidenceQuote(
    value.codexOperationalEvidenceQuote,
    authorText,
  );
  if (evidenceQuote === undefined) return emptyAssessment();

  const reasonJa = typeof value.codexOperationalReasonJa === "string"
    ? value.codexOperationalReasonJa.trim().slice(0, 500) || null
    : null;

  return {
    status: value.codexOperationalStatus,
    confidence,
    evidenceQuote,
    reasonJa,
  };
}

export function getTiboOperationalExpiry(tweetCreatedAt: string) {
  const createdAt = Date.parse(tweetCreatedAt);
  if (!Number.isFinite(createdAt)) return null;
  return new Date(createdAt + TIBO_OPERATIONAL_TTL_MS).toISOString();
}

function isResolvedIncident(incident: OpenAIStatusHistoryLike) {
  return incident.status?.toLowerCase() === "resolved" || timestamp(incident.resolvedAt) !== null;
}

function getIncidentObservedTime(incident: OpenAIStatusHistoryLike) {
  return timestamp(incident.updatedAt) ?? timestamp(incident.createdAt);
}

function getResolvedTime(incident: OpenAIStatusHistoryLike) {
  return timestamp(incident.resolvedAt)
    ?? timestamp(incident.updatedAt)
    ?? timestamp(incident.createdAt);
}

function getOpenAIStatusResult(
  history: Array<OpenAIStatusHistoryLike>,
  affectedCodexComponents: number,
  nowTime: number,
): CodexOperationalDisplayResult {
  if (affectedCodexComponents > 0) {
    return {
      status: "active",
      source: "openai_status",
      observedAt: null,
      expiresAt: null,
    };
  }

  const activeIncidents = history
    .filter((incident) => !isResolvedIncident(incident))
    .map((incident) => ({ incident, time: getIncidentObservedTime(incident) }))
    .filter((item): item is { incident: OpenAIStatusHistoryLike; time: number } =>
      item.time !== null && item.time <= nowTime,
    )
    .sort((left, right) => right.time - left.time);

  if (activeIncidents.length > 0) {
    return {
      status: "active",
      source: "openai_status",
      observedAt: new Date(activeIncidents[0].time).toISOString(),
      expiresAt: null,
    };
  }

  const latestResolution = history
    .filter(isResolvedIncident)
    .map((incident) => getResolvedTime(incident))
    .filter((time): time is number => time !== null && time <= nowTime)
    .sort((left, right) => right - left)
    .at(0);

  if (
    latestResolution !== undefined
    && nowTime - latestResolution < OPENAI_RECOVERY_DISPLAY_TTL_MS
  ) {
    return {
      status: "recovered",
      source: "openai_status",
      observedAt: new Date(latestResolution).toISOString(),
      expiresAt: new Date(latestResolution + OPENAI_RECOVERY_DISPLAY_TTL_MS).toISOString(),
    };
  }

  return {
    status: "none",
    source: "none",
    observedAt: null,
    expiresAt: null,
  };
}

function getTiboStatusResult(
  signals: Array<TiboOperationalSignalLike>,
  nowTime: number,
): CodexOperationalDisplayResult | null {
  const latest = signals
    .filter((signal) => signal.verification_status !== "rejected")
    .filter((signal) => signal.codex_operational_status && signal.codex_operational_status !== "none")
    .map((signal) => ({
      signal,
      createdAt: timestamp(signal.tweet_created_at),
      expiresAt: timestamp(signal.codex_operational_expires_at),
    }))
    .filter((item): item is {
      signal: TiboOperationalSignalLike & { codex_operational_status: Exclude<TiboCodexOperationalStatus, "none"> };
      createdAt: number;
      expiresAt: number;
    } =>
      item.createdAt !== null
      && item.expiresAt !== null
      && item.createdAt <= nowTime
      && nowTime < item.expiresAt,
    )
    .sort((left, right) => right.createdAt - left.createdAt)
    .at(0);

  if (!latest) return null;

  return {
    status: latest.signal.codex_operational_status,
    source: "tibo",
    observedAt: new Date(latest.createdAt).toISOString(),
    expiresAt: new Date(latest.expiresAt).toISOString(),
  };
}

function chooseReliableResult(
  openAI: CodexOperationalDisplayResult,
  tibo: CodexOperationalDisplayResult | null,
): CodexOperationalDisplayResult {
  if (openAI.status === "active") return openAI;
  if (tibo?.status === "active") return tibo;
  if (tibo?.status === "investigating") return tibo;

  if (openAI.status === "recovered" && tibo?.status === "recovered") {
    return {
      status: "recovered",
      source: "combined",
      observedAt: [openAI.observedAt, tibo.observedAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
      expiresAt: [openAI.expiresAt, tibo.expiresAt]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null,
    };
  }
  if (tibo?.status === "recovered") return tibo;
  if (openAI.status === "recovered") return openAI;
  return openAI;
}

export function deriveCodexOperationalStatus(input: {
  openAIStatusHistory: Array<OpenAIStatusHistoryLike>;
  openAIStatusHealth?: { state?: string | null } | null;
  affectedCodexComponents: number;
  tiboSignals: Array<TiboOperationalSignalLike>;
  now: Date;
}): CodexOperationalDisplayResult {
  const nowTime = input.now.getTime();
  const tiboResult = Number.isFinite(nowTime)
    ? getTiboStatusResult(input.tiboSignals, nowTime)
    : null;

  if (!Number.isFinite(nowTime)) {
    return {
      status: "unknown",
      source: "none",
      observedAt: null,
      expiresAt: null,
    };
  }

  if (input.openAIStatusHealth?.state !== "ok") {
    return tiboResult ?? {
      status: "unknown",
      source: "none",
      observedAt: null,
      expiresAt: null,
    };
  }

  const openAIResult = getOpenAIStatusResult(
    input.openAIStatusHistory,
    Math.max(0, input.affectedCodexComponents),
    nowTime,
  );
  return chooseReliableResult(openAIResult, tiboResult);
}
