import { isConditionalBankedDistributionNotice } from "./bankedReset";

export type BankedTeaserLinkCandidate = {
  tweet_id: string;
  text?: string | null;
  tweet_url?: string | null;
  tweet_created_at: string;
  signal_type?: string | null;
  verification_status?: string | null;
  classification_source?: string | null;
  confidence?: number | null;
  teaser_strength?: string | null;
  is_reply?: boolean | null;
  is_quote?: boolean | null;
  expires_at?: string | null;
  temporal_resolution_status?: string | null;
  expected_start_at?: string | null;
  expected_end_at?: string | null;
};

export type BankedTeaserLinkEvent = {
  eventKey: string;
  executionAt: string;
  scopeText: string;
};

export type BankedTeaserLinkInput = {
  candidates: ReadonlyArray<BankedTeaserLinkCandidate>;
  events: ReadonlyArray<BankedTeaserLinkEvent>;
  competingExecutionTimes?: ReadonlyArray<string>;
  protectedEventKeys?: ReadonlySet<string>;
};

type CandidateWindow = {
  candidate: BankedTeaserLinkCandidate;
  createdAt: number;
  expiresAt: number;
  startAt: number;
  endAt: number;
};

const BANKED_COMPATIBLE_TERM = /\b(?:banked\s+resets?|reset\s+credits?|reset\s+buttons?)\b/i;
const FUTURE_TIME_TERM = /\b(?:today|tonight|tomorrow|later\s+today|soon|later|next\s+(?:week|month|year)|(?:this|next)\s+(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)|in\s+(?:a\s+few|a|one|two|few|\d+)\s+hours?|within\s+\d+\s+hours?)\b/i;
const FUTURE_ACTION_TERM = /\b(?:will|we['’]?ll|going\s+to|gonna|coming|come|arrive|land|get|receive|grant|give|credit|load|another|extra|more)\b/i;
const GLOBAL_RESET_TERM = /\b(?:global(?:ly)?|worldwide|full|hard|forced)\b[\s\S]{0,50}\breset\b|\breset\b[\s\S]{0,70}\b(?:globally|worldwide|for\s+(?:all|every)\s+(?:users?|accounts?))\b|\b(?:reset|resetting)\s+(?:everyone|all|every)\b|\b(?:everyone|all\s+(?:paid\s+)?users?|all\s+accounts?)\b[\s\S]{0,50}\b(?:usage\s+limits?|quotas?)\b[\s\S]{0,50}\b(?:reset|back\s+to\s+full)\b|\b(?:all|every)\s+(?:users?|accounts?)\b[\s\S]{0,60}\b(?:usage\s+limits?|quotas?)\b[\s\S]{0,50}\b(?:reset|back\s+to\s+full)\b/i;
const NON_PRODUCTION_RESET_TERM = /\b(?:test(?:ing)?|staging|demo|mock|simulation|simulated|database|\bdb\b)\b/i;
const AUDIENCE_TERM = /\b(?:users?|accounts?|paid|plus|pro|business|enterprise|everyone|all|every|only|eligible|without|except|excluding|who|if)\b/i;
const CONDITIONAL_AUDIENCE_TERM = /\b(?:only|eligible|without|except|excluding|who|if|unless|limited\s+to)\b/i;
const BROAD_AUDIENCE_TERM = /\b(?:everyone|all\s+(?:paid\s+)?users?|all\s+accounts?|all\s+codex\s+and\s+chatgpt\s+work\s+users?|all\s+(?:plus|pro|business|enterprise)(?:\s*,?\s*(?:plus|pro|business|enterprise))*\s+users?)\b/i;
const PLAN_TERM = /\b(?:plus|pro|business|enterprise)\b/i;

function parseTime(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function getAudienceClass(text: string, bankedEvent: boolean): "broad" | "conditional" | "specific" | null {
  if (!AUDIENCE_TERM.test(text)) return null;
  if (CONDITIONAL_AUDIENCE_TERM.test(text) || (bankedEvent && isConditionalBankedDistributionNotice(text))) {
    return "conditional";
  }
  if (BROAD_AUDIENCE_TERM.test(text) || (bankedEvent && /\ball\b/i.test(text))) return "broad";
  return PLAN_TERM.test(text) ? "specific" : null;
}

function hasStrongSemanticEvidence(candidate: BankedTeaserLinkCandidate) {
  if (candidate.teaser_strength !== "strong") return false;
  if (candidate.classification_source === "manual" && candidate.verification_status === "confirmed") {
    return true;
  }

  const text = candidate.text ?? "";
  return candidate.verification_status !== "rejected" &&
    typeof candidate.confidence === "number" &&
    Number.isFinite(candidate.confidence) &&
    candidate.confidence >= 0.95 &&
    BANKED_COMPATIBLE_TERM.test(text) &&
    FUTURE_TIME_TERM.test(text) &&
    FUTURE_ACTION_TERM.test(text);
}

function toCandidateWindow(candidate: BankedTeaserLinkCandidate): CandidateWindow | null {
  if (
    candidate.signal_type !== "teaser" ||
    candidate.verification_status === "rejected" ||
    candidate.is_reply === true ||
    candidate.is_quote === true ||
    !hasStrongSemanticEvidence(candidate)
  ) {
    return null;
  }

  const text = candidate.text ?? "";
  if (GLOBAL_RESET_TERM.test(text) || NON_PRODUCTION_RESET_TERM.test(text)) return null;

  const createdAt = parseTime(candidate.tweet_created_at);
  const expiresAt = parseTime(candidate.expires_at);
  const startAt = parseTime(candidate.expected_start_at);
  const endAt = parseTime(candidate.expected_end_at);
  if (
    candidate.temporal_resolution_status !== "resolved" ||
    createdAt === null ||
    expiresAt === null ||
    startAt === null ||
    endAt === null ||
    endAt < startAt ||
    expiresAt < createdAt
  ) {
    return null;
  }

  return { candidate, createdAt, expiresAt, startAt, endAt };
}

function isScopeCompatible(candidateText: string, eventText: string) {
  const candidateScope = getAudienceClass(candidateText, false);
  const eventScope = getAudienceClass(eventText, true);
  return candidateScope === null || eventScope === null || candidateScope === eventScope;
}

function matchesEvent(window: CandidateWindow, event: BankedTeaserLinkEvent) {
  const executionAt = parseTime(event.executionAt);
  if (executionAt === null) return false;
  return window.createdAt < executionAt &&
    executionAt >= window.startAt &&
    executionAt <= window.endAt &&
    executionAt <= window.expiresAt &&
    isScopeCompatible(window.candidate.text ?? "", event.scopeText);
}

/**
 * Returns only one-to-one, timing-resolved teaser associations. Ambiguous
 * candidate/event pairs are deliberately left unlinked.
 */
export function resolveUniqueBankedTeaserLinks(input: BankedTeaserLinkInput) {
  const uniqueCandidates = new Map<string, CandidateWindow>();
  for (const candidate of input.candidates) {
    const window = toCandidateWindow(candidate);
    if (window && !uniqueCandidates.has(candidate.tweet_id)) {
      uniqueCandidates.set(candidate.tweet_id, window);
    }
  }

  const validEvents = input.events.filter((event) => event.eventKey && parseTime(event.executionAt) !== null);
  const competingTimes = (input.competingExecutionTimes ?? [])
    .map((value) => parseTime(value))
    .filter((value): value is number => value !== null);
  const matchesByEvent = new Map<string, CandidateWindow[]>();
  const matchesByCandidate = new Map<string, BankedTeaserLinkEvent[]>();

  for (const window of Array.from(uniqueCandidates.values())) {
    const matchedEvents = validEvents.filter((event) => matchesEvent(window, event));
    matchesByCandidate.set(window.candidate.tweet_id, matchedEvents);
    for (const event of matchedEvents) {
      const matches = matchesByEvent.get(event.eventKey) ?? [];
      matches.push(window);
      matchesByEvent.set(event.eventKey, matches);
    }
  }

  const links = new Map<string, BankedTeaserLinkCandidate>();
  for (const event of validEvents) {
    if (input.protectedEventKeys?.has(event.eventKey)) continue;
    const candidates = matchesByEvent.get(event.eventKey) ?? [];
    if (candidates.length !== 1) continue;
    const [window] = candidates;
    const candidateEvents = matchesByCandidate.get(window.candidate.tweet_id) ?? [];
    if (candidateEvents.length !== 1) continue;
    if (competingTimes.some((time) => time >= window.startAt && time <= window.endAt)) continue;
    links.set(event.eventKey, window.candidate);
  }

  return links;
}
