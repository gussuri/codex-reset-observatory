import type {
  TiboEvidenceContext,
  TiboEvidenceNode,
  TiboEvidenceOmissionReason,
  TiboEvidenceRelation,
} from "./tiboEvidenceContext";

export const TIBO_EVIDENCE_INPUT_VERSION = "tibo-classification-evidence-input-v1" as const;

const ROOT_ID = /^\d{15,25}$/;
const RELATED_ID = /^\d{1,30}$/;
const STATUS_PATH = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/;
const MAX_RELATED_POSTS = 3;
const MAX_RELATED_TEXT_UNITS = 4_000;
const MAX_TOTAL_RELATED_TEXT_UNITS = 8_000;
const MAX_TARGET_TEXT_UNITS = 25_000;
const VALID_STATUSES = new Set(["complete", "partial", "unknown", "unavailable"]);
const VALID_RELATIONS = new Set(["reply", "quote"]);
const VALID_OMISSIONS = new Set<TiboEvidenceOmissionReason>([
  "missing_provenance",
  "invalid_snapshot",
  "invalid_url",
  "id_mismatch",
  "author_mismatch",
  "invalid_post",
  "not_found",
  "duplicate_candidates",
  "rejected",
  "unverified",
  "future_post",
  "self_reference",
  "cycle",
  "depth_limit",
  "related_posts_limit",
  "lookup_limit",
  "post_body_limit",
  "total_body_limit",
  "lookup_failed",
  "text_mismatch",
  "relation_conflict",
]);

type EvidenceInputNode = Pick<TiboEvidenceNode, "tweetId" | "tweetUrl" | "authorHandle" | "text" | "createdAt">;
type EvidenceInputOmission = {
  fromTweetId: string;
  relation?: TiboEvidenceRelation;
  toTweetId?: string;
  reason: TiboEvidenceOmissionReason;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function parseNode(value: unknown, isTarget: boolean): EvidenceInputNode | null {
  if (!isObject(value)) return null;
  const { tweetId, tweetUrl, authorHandle, text, createdAt } = value;
  if (typeof tweetId !== "string" || !(isTarget ? ROOT_ID : RELATED_ID).test(tweetId)
    || typeof tweetUrl !== "string" || typeof authorHandle !== "string"
    || typeof text !== "string" || !text.trim() || typeof createdAt !== "string") return null;
  if (text.length > (isTarget ? MAX_TARGET_TEXT_UNITS : MAX_RELATED_TEXT_UNITS)) return null;
  const createdAtMs = Date.parse(createdAt);
  if (!Number.isFinite(createdAtMs) || new Date(createdAtMs).toISOString() !== createdAt) return null;

  try {
    const url = new URL(tweetUrl);
    if (url.protocol !== "https:" || !/^(?:x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(STATUS_PATH);
    if (!match || match[2] !== tweetId) return null;
    const expectedHandle = `@${match[1]!.toLowerCase()}`;
    if (authorHandle.trim().replace(/^@/, "").toLowerCase() !== expectedHandle.slice(1)) return null;
    if (isTarget && expectedHandle !== "@thsottiaux") return null;
    return { tweetId, tweetUrl, authorHandle: expectedHandle, createdAt, text };
  } catch {
    return null;
  }
}

function parseOmission(value: unknown): EvidenceInputOmission | null {
  if (!isObject(value)) return null;
  const { fromTweetId, relation, toTweetId, reason } = value;
  if (typeof fromTweetId !== "string" || !RELATED_ID.test(fromTweetId)
    || (relation !== undefined && (typeof relation !== "string" || !VALID_RELATIONS.has(relation)))
    || typeof reason !== "string" || !VALID_OMISSIONS.has(reason as TiboEvidenceOmissionReason)) return null;
  const safeToTweetId = typeof toTweetId === "string" && RELATED_ID.test(toTweetId) ? toTweetId : undefined;
  return {
    fromTweetId,
    ...(relation ? { relation: relation as TiboEvidenceRelation } : {}),
    ...(safeToTweetId ? { toTweetId: safeToTweetId } : {}),
    reason: reason as TiboEvidenceOmissionReason,
  };
}

function hasCycle(ids: readonly string[], edges: readonly { fromTweetId: string; toTweetId: string }[]) {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.fromTweetId, [...(outgoing.get(edge.fromTweetId) ?? []), edge.toTweetId]);
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    for (const next of outgoing.get(id) ?? []) if (visit(next)) return true;
    visiting.delete(id);
    visited.add(id);
    return false;
  };
  return ids.some(visit);
}

function exceedsGraphDepthOrHasDisconnectedNodes(
  rootId: string,
  ids: readonly string[],
  edges: readonly { fromTweetId: string; toTweetId: string }[],
) {
  const outgoing = new Map<string, string[]>();
  for (const edge of edges) outgoing.set(edge.fromTweetId, [...(outgoing.get(edge.fromTweetId) ?? []), edge.toTweetId]);
  const depthById = new Map([[rootId, 0]]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift()!;
    const depth = depthById.get(current)!;
    for (const next of outgoing.get(current) ?? []) {
      if (depth + 1 > 2) return true;
      if (!depthById.has(next)) {
        depthById.set(next, depth + 1);
        queue.push(next);
      }
    }
  }
  return ids.some((id) => !depthById.has(id));
}

function parseContext(value: unknown): {
  contextStatus: string;
  target: EvidenceInputNode;
  relatedPosts: EvidenceInputNode[];
  relations: Array<{ fromTweetId: string; toTweetId: string; relation: TiboEvidenceRelation }>;
  omissions: EvidenceInputOmission[];
  lookupCount: number;
} | null {
  if (!isObject(value) || value.version !== "tibo-evidence-context-v1"
    || typeof value.status !== "string" || !VALID_STATUSES.has(value.status)
    || !Number.isInteger(value.lookupCount) || Number(value.lookupCount) < 0 || Number(value.lookupCount) > 3
    || !Array.isArray(value.relatedPosts) || value.relatedPosts.length > MAX_RELATED_POSTS
    || !Array.isArray(value.edges) || value.edges.length > 8
    || !Array.isArray(value.omissions) || value.omissions.length > 16) return null;

  const target = parseNode(value.target, true);
  if (!target) return null;
  const relatedPosts = value.relatedPosts.map((post) => parseNode(post, false));
  if (relatedPosts.some((post) => !post)) return null;
  const safeRelatedPosts = relatedPosts as EvidenceInputNode[];
  const totalRelatedTextUnits = safeRelatedPosts.reduce((total, post) => total + post.text.length, 0);
  if (totalRelatedTextUnits > MAX_TOTAL_RELATED_TEXT_UNITS) return null;

  const nodesById = new Map([[target.tweetId, target], ...safeRelatedPosts.map((post) => [post.tweetId, post] as const)]);
  if (nodesById.size !== safeRelatedPosts.length + 1) return null;

  const relations: Array<{ fromTweetId: string; toTweetId: string; relation: TiboEvidenceRelation }> = [];
  const edgeKeys = new Set<string>();
  for (const edge of value.edges) {
    if (!isObject(edge) || typeof edge.fromTweetId !== "string" || typeof edge.toTweetId !== "string"
      || typeof edge.relation !== "string" || !VALID_RELATIONS.has(edge.relation)
      || edge.fromTweetId === edge.toTweetId || !nodesById.has(edge.fromTweetId) || !nodesById.has(edge.toTweetId)) return null;
    const key = `${edge.fromTweetId}\u0000${edge.toTweetId}\u0000${edge.relation}`;
    if (edgeKeys.has(key)) return null;
    edgeKeys.add(key);
    relations.push({
      fromTweetId: edge.fromTweetId,
      toTweetId: edge.toTweetId,
      relation: edge.relation as TiboEvidenceRelation,
    });
  }
  const nodeIds = Array.from(nodesById.keys());
  if (hasCycle(nodeIds, relations)) return null;
  if (exceedsGraphDepthOrHasDisconnectedNodes(target.tweetId, nodeIds, relations)) return null;
  if (safeRelatedPosts.some((post) => !relations.some((edge) => edge.toTweetId === post.tweetId))) return null;

  const omissions = value.omissions.map(parseOmission);
  if (omissions.some((omission) => !omission)) return null;
  const safeOmissions = omissions as EvidenceInputOmission[];
  if (value.status === "complete" && (safeRelatedPosts.length === 0 || safeOmissions.length > 0)) return null;
  if (value.status === "unknown" && (safeRelatedPosts.length > 0 || relations.length > 0 || safeOmissions.length > 0)) return null;
  if (value.status === "partial" && safeOmissions.length === 0) return null;
  if (value.status === "unavailable" && (safeRelatedPosts.length > 0 || safeOmissions.length === 0
    || safeOmissions.some((omission) => omission.reason !== "lookup_failed"))) return null;

  return {
    contextStatus: value.status,
    target,
    relatedPosts: safeRelatedPosts,
    relations,
    omissions: safeOmissions,
    lookupCount: Number(value.lookupCount),
  };
}

export function formatTiboEvidenceInput(context: TiboEvidenceContext | unknown): string {
  const parsed = parseContext(context);
  if (!parsed) throw new Error("invalid Tibo evidence context");
  return JSON.stringify({
    formatVersion: TIBO_EVIDENCE_INPUT_VERSION,
    contextStatus: parsed.contextStatus,
    target: parsed.target,
    relatedPosts: parsed.relatedPosts,
    relations: parsed.relations,
    omissions: parsed.omissions,
    lookupCount: parsed.lookupCount,
  });
}
