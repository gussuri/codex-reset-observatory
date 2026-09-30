import type { CodexOperationalStatus } from "./types";

export type TiboCodexOperationalState = "investigating" | "active" | "recovered" | "none";

export type ParsedCodexOperationalAssessment = {
  codex_operational_status: TiboCodexOperationalState | null;
  codex_operational_confidence: number | null;
  codex_operational_evidence_quote: string | null;
  codex_operational_reason_ja: string | null;
};

export type TiboCodexOperationalSignal = {
  tweet_id?: string;
  tweet_created_at?: string | null;
  verification_status?: string | null;
  codex_operational_status?: string | null;
  codex_operational_expires_at?: string | null;
};

const CODEX_OPERATIONAL_NON_NONE_STATES = new Set<TiboCodexOperationalState>([
  "investigating",
  "active",
  "recovered",
]);
const CODEX_OPERATIONAL_TTL_MS = 12 * 60 * 60 * 1000;
const CODEX_RECOVERED_DISPLAY_TTL_MS = 2 * 60 * 60 * 1000;

function getOperationalTtlMs(status: Exclude<TiboCodexOperationalState, "none">): number {
  return status === "recovered"
    ? CODEX_RECOVERED_DISPLAY_TTL_MS
    : CODEX_OPERATIONAL_TTL_MS;
}

function emptyAssessment(): ParsedCodexOperationalAssessment {
  return {
    codex_operational_status: null,
    codex_operational_confidence: null,
    codex_operational_evidence_quote: null,
    codex_operational_reason_ja: null,
  };
}

function effectiveNoneAssessment(): ParsedCodexOperationalAssessment {
  return {
    codex_operational_status: "none",
    codex_operational_confidence: null,
    codex_operational_evidence_quote: null,
    codex_operational_reason_ja: null,
  };
}

function isOperationalState(value: unknown): value is TiboCodexOperationalState {
  return value === "none" || CODEX_OPERATIONAL_NON_NONE_STATES.has(value as TiboCodexOperationalState);
}

function hasRecoveredServiceEvidence(authorText: string, evidenceQuote: string): boolean {
  if (/\b(?:not|never|no longer|not yet|isn't|aren't|wasn't|weren't|hasn't|haven't|won't|will not|can't|cannot)\b[^.!?\n]{0,45}\b(?:back|fixed|resolved|restored|recovered|normal)\b/i.test(evidenceQuote)) {
    return false;
  }
  if (/\b(?:will|would|could|may|might|should)\s+(?:(?:possibly|probably|maybe)\s+)?(?:be|get)\s+(?:back|fixed|resolved|restored|recovered|normal|over)\b|\b(?:plan\w*|hope\w*|expect\w*)\s+to\s+(?:be|get)\s+(?:back|fixed|resolved|restored|recovered|normal|over)\b|\bgoing to\s+(?:be|get)\s+(?:back|fixed|resolved|restored|recovered|normal|over)\b|\b(?:may|might|could)\s+have\s+(?:already\s+)?(?:recovered|restored)\b/i.test(evidenceQuote)) {
    return false;
  }
  if (/\bwe(?:['’]re| are) back in action\b/i.test(evidenceQuote)) return true;
  const hasCurrentRecoveryAssertion = /\b(?:am|is|are|has been|have been)\s+(?:(?:now|currently|finally)\s+)?(?:back|fixed|resolved|restored|recovered)\b|\b(?:fixed|resolved|restored|recovered)\s+now\b/i.test(evidenceQuote);
  if (
    /\b(?:last week|last month|last year|\d+ weeks? ago|\d+ months? ago|back in 20\d{2})\b/i.test(evidenceQuote) &&
    !hasCurrentRecoveryAssertion
  ) {
    return false;
  }

  const mentionsResetAxis = /\b(?:resets?|usage[- ]?limits?|quotas?|banked|distribution|propagation)\b/i.test(authorText);
  const hasSeparateServiceCue = /\b(?:codex|service|outage|incident|disruption|degrad\w*|down|requests? (?:are )?(?:failing|slow)|cache hit rates?)\b/i.test(evidenceQuote);

  if (
    /\b(?:codex|(?:the )?service|things)\s+(?:is|are|was|were|has been|have been)\s+(?:(?:now|finally)\s+)?back(?:\s+(?:to normal|online|up|in action))?\b/i.test(evidenceQuote) ||
    /\b(?:codex|(?:the )?service)\s+(?:is|are|was|were|has been|have been)\s+(?:(?:now|finally)\s+)?(?:fixed|resolved|restored|recovered)\b/i.test(evidenceQuote) ||
    /\b(?:outage|incident|disruption|service issue|codex issue)\s+(?:(?:is|was)\s+|has been\s+|is now\s+|has now been\s+)?(?:fixed|resolved|restored|recovered|over)\b/i.test(evidenceQuote) ||
    /\b(?:recovered|restored|fixed|resolved) from (?:the )?(?:codex )?(?:outage|incident|disruption|service issue)\b/i.test(evidenceQuote)
  ) {
    return true;
  }

  const genericIssueResolution = /\b(?:issue|problem)\b[^.!?\n]{0,60}\b(?:fixed|resolved|restored|over)\b/i.test(evidenceQuote);
  if (genericIssueResolution && (!mentionsResetAxis || hasSeparateServiceCue)) return true;

  // Generic recovery phrases are usable on their own, except when the post
  // talks about reset/quota state; there they need a separate service cue.
  const genericRecoveryPhrase = /\b(?:fixed now|recovered|back to normal)\b/i.test(evidenceQuote);
  return genericRecoveryPhrase && (!mentionsResetAxis || hasSeparateServiceCue);
}

function hasActiveServiceEvidence(evidenceQuote: string): boolean {
  if (/\b(?:not|never|no longer|not yet|isn't|aren't|wasn't|weren't|hasn't|haven't|won't|will not|can't|cannot)\b[^.!?\n]{0,45}\b(?:down|degrad\w*|unavailable|offline|fail\w*|broken|error\w*|outage)\b/i.test(evidenceQuote)) {
    return false;
  }
  const serviceSubject = "(?:codex|(?:the )?service|requests?|availability)";
  const impact = "(?:down|degrad\\w*|unavailable|offline|fail\\w*|broken|error\\w*|outage)";
  const forward = new RegExp(`\\b${serviceSubject}\\b[^.!?\\n]{0,80}\\b${impact}\\b`, "i");
  const reverse = new RegExp(`\\b${impact}\\b[^.!?\\n]{0,80}\\b${serviceSubject}\\b`, "i");
  return forward.test(evidenceQuote) || reverse.test(evidenceQuote);
}

function hasInvestigationEvidence(evidenceQuote: string): boolean {
  if (/\b(?:not|never|no longer|isn't|aren't|wasn't|weren't|hasn't|haven't|won't|will not|can't|cannot)\b[^.!?\n]{0,45}\b(?:investigat\w*|looking into|debugg\w*|diagnos\w*)\b/i.test(evidenceQuote)) {
    return false;
  }
  const investigation = /\b(?:investigat\w*|looking into|debugg\w*|diagnos\w*)\b/i;
  const operationalIssue = /\b(?:outage|disruption|incident|degrad\w*|down|unavailable|cache hit rates?|latency|availability|requests? (?:are )?(?:failing|slow|erroring)|codex service issue)\b/i;
  return investigation.test(evidenceQuote) && operationalIssue.test(evidenceQuote);
}

function hasIndependentOperationalEvidence(
  status: Exclude<TiboCodexOperationalState, "none">,
  authorText: string,
  evidenceQuote: string,
): boolean {
  if (status === "recovered") return hasRecoveredServiceEvidence(authorText, evidenceQuote);
  if (status === "active") return hasActiveServiceEvidence(evidenceQuote);
  return hasInvestigationEvidence(evidenceQuote);
}

/**
 * Parses the independent, display-only operational axis. Invalid operational
 * output is discarded without affecting the primary reset classification.
 */
export function parseCodexOperationalAssessment(
  value: unknown,
  authorText: string,
): ParsedCodexOperationalAssessment {
  if (!value || typeof value !== "object" || Array.isArray(value)) return emptyAssessment();

  const parsed = value as Record<string, unknown>;
  const status = parsed.codexOperationalStatus;
  const confidence = parsed.codexOperationalConfidence;
  if (
    !isOperationalState(status) ||
    typeof confidence !== "number" ||
    !Number.isFinite(confidence) ||
    confidence < 0 ||
    confidence > 1
  ) {
    return emptyAssessment();
  }

  const evidenceQuote = parsed.codexOperationalEvidenceQuote;
  let validEvidenceQuote: string | null = null;
  if (status !== "none") {
    if (
      typeof evidenceQuote !== "string" ||
      evidenceQuote.trim().length === 0 ||
      evidenceQuote.length > 300 ||
      !authorText.includes(evidenceQuote.trim())
    ) {
      return emptyAssessment();
    }
    validEvidenceQuote = evidenceQuote.trim();
    if (!hasIndependentOperationalEvidence(status, authorText, validEvidenceQuote)) {
      return effectiveNoneAssessment();
    }
  }

  const reason = parsed.codexOperationalReasonJa;
  return {
    codex_operational_status: status,
    codex_operational_confidence: confidence,
    codex_operational_evidence_quote: validEvidenceQuote,
    codex_operational_reason_ja: typeof reason === "string" && reason.trim()
      ? reason.trim().slice(0, 500)
      : null,
  };
}

export function getCodexOperationalExpiryAt(
  status: TiboCodexOperationalState | null | undefined,
  tweetCreatedAt: string,
): string | null {
  if (!status || status === "none") return null;
  const createdAt = Date.parse(tweetCreatedAt);
  return Number.isFinite(createdAt)
    ? new Date(createdAt + getOperationalTtlMs(status)).toISOString()
    : null;
}

function isNonNoneOperationalState(value: unknown): value is Exclude<TiboCodexOperationalState, "none"> {
  return value === "investigating" || value === "active" || value === "recovered";
}

/** Returns the newest still-eligible Tibo operational assertion. */
export function getLatestTiboCodexOperationalSignal<T extends TiboCodexOperationalSignal>(
  signals: ReadonlyArray<T>,
  now: Date,
): T | null {
  const nowTime = now.getTime();
  if (!Number.isFinite(nowTime)) return null;

  const latestSignal = signals
    .filter((signal) => {
      if (signal.verification_status === "rejected") return false;
      if (!isNonNoneOperationalState(signal.codex_operational_status)) return false;

      const createdAt = Date.parse(signal.tweet_created_at ?? "");
      const persistedExpiry = Date.parse(signal.codex_operational_expires_at ?? "");
      if (!Number.isFinite(createdAt) || !Number.isFinite(persistedExpiry)) return false;
      if (createdAt > nowTime) return false;
      return true;
    })
    .slice()
    .sort((left, right) => {
      const timeDifference = Date.parse(right.tweet_created_at ?? "") - Date.parse(left.tweet_created_at ?? "");
      if (timeDifference !== 0) return timeDifference;
      return (right.tweet_id ?? "").localeCompare(left.tweet_id ?? "");
    })[0] ?? null;

  if (!latestSignal) return null;
  if (!isNonNoneOperationalState(latestSignal.codex_operational_status)) return null;

  const createdAt = Date.parse(latestSignal.tweet_created_at ?? "");
  const persistedExpiry = Date.parse(latestSignal.codex_operational_expires_at ?? "");
  // A newer expired update supersedes older signals; it must not revive an
  // older active state when its own display window ends.
  const effectiveExpiry = Math.min(
    persistedExpiry,
    createdAt + getOperationalTtlMs(latestSignal.codex_operational_status),
  );
  return nowTime < effectiveExpiry ? latestSignal : null;
}

export function resolveCodexOperationalStatusForDisplay(
  openAIStatus: CodexOperationalStatus | null | undefined,
  tiboSignals: ReadonlyArray<TiboCodexOperationalSignal>,
  now: Date,
): CodexOperationalStatus {
  if (openAIStatus === "active") return "active";

  const latestTiboSignal = getLatestTiboCodexOperationalSignal(tiboSignals, now);
  const tiboStatus = latestTiboSignal?.codex_operational_status;
  if (tiboStatus === "active") return "active";
  if (tiboStatus === "investigating") return "investigating";
  if (tiboStatus === "recovered" || openAIStatus === "recovered") return "recovered";
  return openAIStatus ?? "unknown";
}
