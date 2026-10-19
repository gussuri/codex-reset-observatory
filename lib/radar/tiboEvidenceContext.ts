export type TiboEvidenceRelation = "reply" | "quote";

export type TiboEvidencePost = {
  tweetId: string;
  tweetUrl: string;
  text: string;
  createdAt: string;
  verificationStatus?: unknown;
  sourceContextSnapshot?: unknown;
  isReply?: unknown;
  replyContextText?: unknown;
  isQuote?: unknown;
  quoteTweetUrl?: unknown;
  quoteAuthorHandle?: unknown;
  quoteContextText?: unknown;
  sourceContextRevisionHashes?: string[];
  sourceContextClassifiedRevisionHashes?: string[];
};

export type TiboEvidenceLookup = (tweetId: string) => Promise<readonly TiboEvidencePost[]>;

export type TiboEvidenceNode = {
  tweetId: string;
  tweetUrl: string;
  authorHandle: string;
  text: string;
  createdAt: string;
};

export type TiboEvidenceOmissionReason =
  | "missing_provenance"
  | "invalid_snapshot"
  | "invalid_url"
  | "id_mismatch"
  | "author_mismatch"
  | "invalid_post"
  | "not_found"
  | "duplicate_candidates"
  | "rejected"
  | "unverified"
  | "future_post"
  | "self_reference"
  | "cycle"
  | "depth_limit"
  | "related_posts_limit"
  | "lookup_limit"
  | "post_body_limit"
  | "total_body_limit"
  | "lookup_failed"
  | "text_mismatch"
  | "relation_conflict";

export type TiboEvidenceContext = {
  version: "tibo-evidence-context-v1";
  status: "complete" | "partial" | "unknown" | "unavailable" | "invalid_target";
  target: TiboEvidenceNode | null;
  relatedPosts: TiboEvidenceNode[];
  edges: Array<{ fromTweetId: string; toTweetId: string; relation: TiboEvidenceRelation }>;
  omissions: Array<{
    fromTweetId: string;
    relation?: TiboEvidenceRelation;
    toTweetId?: string;
    reason: TiboEvidenceOmissionReason;
  }>;
  lookupCount: number;
};

const MAX_HOPS = 2;
const MAX_RELATED_POSTS = 3;
const MAX_RELATED_POST_LOOKUPS = 3;
const MAX_RELATED_POST_TEXT_UNITS = 4_000;
const MAX_TOTAL_RELATED_TEXT_UNITS = 8_000;
const MAX_TARGET_TEXT_UNITS = 25_000;
const MAX_SNAPSHOT_EXCERPT_UNITS = 1_000;
const TARGET_ID_PATTERN = /^\d{15,25}$/;
const RELATED_ID_PATTERN = /^\d{1,30}$/;
const TWEET_URL_PATH_PATTERN = /^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/;

type TweetIdentity = { tweetId: string; authorHandle: string; tweetUrl: string };
type ValidPost = { node: TiboEvidenceNode; createdAtMs: number };
type DeclaredRelation = {
  relation: TiboEvidenceRelation;
  tweetId: string;
  tweetUrl: string;
  expectedAuthor: string;
  excerpt?: string;
};
type RelationDeclaration = DeclaredRelation | {
  relation: TiboEvidenceRelation;
  tweetId?: string;
  reason: TiboEvidenceOmissionReason;
};
type LookupResult = { rows: readonly TiboEvidencePost[] } | { failed: true };
type PendingPost = {
  post: TiboEvidencePost;
  node: TiboEvidenceNode;
  depth: number;
  ancestors: ReadonlySet<string>;
};

function normalizeHandle(value: string) {
  return `@${value.trim().replace(/^@/, "").toLowerCase()}`;
}

function inspectTweetUrl(value: unknown): TweetIdentity | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !/^(?:x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(TWEET_URL_PATH_PATTERN);
    if (!match || !RELATED_ID_PATTERN.test(match[2]!)) return null;
    const authorHandle = normalizeHandle(match[1]!);
    const username = authorHandle.slice(1);
    return {
      tweetId: match[2]!,
      authorHandle,
      tweetUrl: `https://x.com/${username}/status/${match[2]}`,
    };
  } catch {
    return null;
  }
}

function validPost(post: TiboEvidencePost, expectedId?: string): { valid: true; value: ValidPost } | { valid: false; reason: TiboEvidenceOmissionReason } {
  if (!post || typeof post !== "object" || typeof post.tweetId !== "string" || !RELATED_ID_PATTERN.test(post.tweetId)) {
    return { valid: false, reason: "invalid_post" };
  }
  if (expectedId !== undefined && post.tweetId !== expectedId) return { valid: false, reason: "id_mismatch" };
  const identity = inspectTweetUrl(post.tweetUrl);
  if (!identity) return { valid: false, reason: "invalid_url" };
  if (identity.tweetId !== post.tweetId) return { valid: false, reason: "id_mismatch" };
  if (typeof post.text !== "string" || post.text.trim().length === 0 || typeof post.createdAt !== "string") {
    return { valid: false, reason: "invalid_post" };
  }
  const createdAtMs = Date.parse(post.createdAt);
  if (!Number.isFinite(createdAtMs)) return { valid: false, reason: "invalid_post" };
  return {
    valid: true,
    value: {
      node: {
        tweetId: post.tweetId,
        tweetUrl: identity.tweetUrl,
        authorHandle: identity.authorHandle,
        text: post.text,
        createdAt: new Date(createdAtMs).toISOString(),
      },
      createdAtMs,
    },
  };
}

function hasOwn(value: Record<string, unknown>, key: string) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function parseSnapshotItem(
  raw: unknown,
  relation: TiboEvidenceRelation,
): DeclaredRelation | RelationDeclaration {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { relation, reason: "invalid_snapshot" };
  const item = raw as Record<string, unknown>;
  const allowedKeys = ["tweetId", "tweetUrl", "authorHandle", "text"];
  if (Object.keys(item).length !== allowedKeys.length || Object.keys(item).some((key) => !allowedKeys.includes(key))) {
    return { relation, reason: "invalid_snapshot" };
  }
  if (typeof item.tweetId !== "string" || !RELATED_ID_PATTERN.test(item.tweetId)) {
    return { relation, reason: "invalid_snapshot" };
  }
  const identity = inspectTweetUrl(item.tweetUrl);
  if (!identity) return { relation, reason: "invalid_url", tweetId: item.tweetId };
  if (identity.tweetId !== item.tweetId) return { relation, reason: "id_mismatch", tweetId: item.tweetId };
  if (typeof item.authorHandle !== "string" || normalizeHandle(item.authorHandle) !== identity.authorHandle) {
    return { relation, reason: "author_mismatch", tweetId: item.tweetId };
  }
  if (typeof item.text !== "string" || item.text.length === 0 || item.text.length > MAX_SNAPSHOT_EXCERPT_UNITS) {
    return { relation, reason: "invalid_snapshot", tweetId: item.tweetId };
  }
  return {
    relation,
    tweetId: identity.tweetId,
    tweetUrl: identity.tweetUrl,
    expectedAuthor: identity.authorHandle,
    excerpt: item.text,
  };
}

function textOrNull(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function declaredRelations(post: TiboEvidencePost): RelationDeclaration[] {
  const declarations: RelationDeclaration[] = [];
  const snapshotPresent = post.sourceContextSnapshot !== null && post.sourceContextSnapshot !== undefined;
  let snapshot: Record<string, unknown> = {};
  if (snapshotPresent) {
    if (!post.sourceContextSnapshot || typeof post.sourceContextSnapshot !== "object" || Array.isArray(post.sourceContextSnapshot)) {
      declarations.push({ relation: "reply", reason: "invalid_snapshot" });
      return declarations;
    }
    snapshot = post.sourceContextSnapshot as Record<string, unknown>;
    const keys = Object.keys(snapshot);
    if (keys.some((key) => key !== "parent" && key !== "quote")) {
      declarations.push({ relation: "reply", reason: "invalid_snapshot" });
      return declarations;
    }
  }

  const snapshotParent = hasOwn(snapshot, "parent")
    ? parseSnapshotItem(snapshot.parent, "reply")
    : null;
  const snapshotQuote = hasOwn(snapshot, "quote")
    ? parseSnapshotItem(snapshot.quote, "quote")
    : null;

  if (snapshotParent) {
    declarations.push(snapshotParent);
    const sidecar = textOrNull(post.replyContextText);
    if (sidecar && "excerpt" in snapshotParent && sidecar !== snapshotParent.excerpt) {
      declarations.push({ relation: "reply", tweetId: snapshotParent.tweetId, reason: "relation_conflict" });
    }
  } else if (post.isReply === true || textOrNull(post.replyContextText)) {
    declarations.push({ relation: "reply", reason: "missing_provenance" });
  }

  const hasLegacyQuoteFields = post.quoteTweetUrl !== null && post.quoteTweetUrl !== undefined
    || post.quoteAuthorHandle !== null && post.quoteAuthorHandle !== undefined
    || post.quoteContextText !== null && post.quoteContextText !== undefined;
  const legacyQuoteIndicated = post.isQuote === true || hasLegacyQuoteFields;
  if (snapshotQuote) {
    declarations.push(snapshotQuote);
    if (legacyQuoteIndicated && !("reason" in snapshotQuote)) {
      const legacyUrl = textOrNull(post.quoteTweetUrl);
      const legacyAuthor = textOrNull(post.quoteAuthorHandle);
      const legacyText = textOrNull(post.quoteContextText);
      const identity = legacyUrl ? inspectTweetUrl(legacyUrl) : null;
      if ((legacyUrl && (!identity || identity.tweetId !== snapshotQuote.tweetId || identity.authorHandle !== snapshotQuote.expectedAuthor))
        || (legacyAuthor && normalizeHandle(legacyAuthor) !== snapshotQuote.expectedAuthor)
        || (legacyText && "excerpt" in snapshotQuote && legacyText !== snapshotQuote.excerpt)) {
        declarations.push({ relation: "quote", tweetId: snapshotQuote.tweetId, reason: "relation_conflict" });
      }
    }
  } else if (legacyQuoteIndicated) {
    const tweetUrl = textOrNull(post.quoteTweetUrl);
    const authorHandle = textOrNull(post.quoteAuthorHandle);
    const excerpt = textOrNull(post.quoteContextText) ?? undefined;
    if (!tweetUrl || !authorHandle) {
      declarations.push({ relation: "quote", reason: "missing_provenance" });
    } else if (excerpt && excerpt.length > MAX_SNAPSHOT_EXCERPT_UNITS) {
      declarations.push({ relation: "quote", reason: "invalid_snapshot" });
    } else {
      const identity = inspectTweetUrl(tweetUrl);
      if (!identity) declarations.push({ relation: "quote", reason: "invalid_url" });
      else if (normalizeHandle(authorHandle) !== identity.authorHandle) declarations.push({ relation: "quote", tweetId: identity.tweetId, reason: "author_mismatch" });
      else declarations.push({ relation: "quote", tweetId: identity.tweetId, tweetUrl: identity.tweetUrl, expectedAuthor: identity.authorHandle, ...(excerpt ? { excerpt } : {}) });
    }
  }

  const conflictedRelations = new Set(
    declarations.filter((declaration) => "reason" in declaration && declaration.reason === "relation_conflict")
      .map((declaration) => declaration.relation),
  );
  if (conflictedRelations.size === 0) return declarations;

  const conflicts = new Set<TiboEvidenceRelation>();
  return declarations.filter((declaration) => {
    if (!conflictedRelations.has(declaration.relation)) return true;
    if (!("reason" in declaration) || declaration.reason !== "relation_conflict") return false;
    if (conflicts.has(declaration.relation)) return false;
    conflicts.add(declaration.relation);
    return true;
  });
}

function invalidTargetResult(reason?: TiboEvidenceOmissionReason, tweetId = ""): TiboEvidenceContext {
  return {
    version: "tibo-evidence-context-v1",
    status: "invalid_target",
    target: null,
    relatedPosts: [],
    edges: [],
    omissions: reason ? [{ fromTweetId: tweetId, reason }] : [],
    lookupCount: 0,
  };
}

function excerptMatches(excerpt: string | undefined, original: string) {
  if (excerpt === undefined) return true;
  return excerpt === original.slice(0, MAX_SNAPSHOT_EXCERPT_UNITS).trim();
}

function statusFor(relatedPosts: readonly TiboEvidenceNode[], omissions: TiboEvidenceContext["omissions"]): TiboEvidenceContext["status"] {
  if (omissions.length === 0) return relatedPosts.length === 0 ? "unknown" : "complete";
  if (relatedPosts.length === 0 && omissions.every((item) => item.reason === "lookup_failed")) return "unavailable";
  return "partial";
}

export async function buildTiboEvidenceContext(
  target: TiboEvidencePost,
  loadByTweetId: TiboEvidenceLookup,
): Promise<TiboEvidenceContext> {
  const targetIdentity = inspectTweetUrl(target?.tweetUrl);
  if (!targetIdentity || !TARGET_ID_PATTERN.test(target?.tweetId ?? "") || targetIdentity.tweetId !== target.tweetId) {
    return invalidTargetResult("invalid_post", typeof target?.tweetId === "string" ? target.tweetId : "");
  }
  if (targetIdentity.authorHandle !== "@thsottiaux") return invalidTargetResult("author_mismatch", target.tweetId);
  if (target.verificationStatus === "rejected") return invalidTargetResult("rejected", target.tweetId);
  if (target.verificationStatus !== "auto_unverified" && target.verificationStatus !== "confirmed") {
    return invalidTargetResult("unverified", target.tweetId);
  }
  const targetValidation = validPost(target, target.tweetId);
  if (!targetValidation.valid) return invalidTargetResult(targetValidation.reason, target.tweetId);
  if (target.text.length > MAX_TARGET_TEXT_UNITS) return invalidTargetResult("post_body_limit", target.tweetId);

  const relatedPosts: TiboEvidenceNode[] = [];
  const edges: TiboEvidenceContext["edges"] = [];
  const omissions: TiboEvidenceContext["omissions"] = [];
  const knownPosts = new Map<string, ValidPost>([[target.tweetId, targetValidation.value]]);
  const rawPosts = new Map<string, TiboEvidencePost>([[target.tweetId, target]]);
  const lookupCache = new Map<string, LookupResult>();
  const pending: PendingPost[] = [{ post: target, node: targetValidation.value.node, depth: 0, ancestors: new Set([target.tweetId]) }];
  let lookupCount = 0;
  let relatedTextUnits = 0;
  const visited = new Set<string>([target.tweetId]);

  const omit = (fromTweetId: string, relation: TiboEvidenceRelation | undefined, reason: TiboEvidenceOmissionReason, toTweetId?: string) => {
    omissions.push({ fromTweetId, ...(relation ? { relation } : {}), ...(toTweetId ? { toTweetId } : {}), reason });
  };
  const hasPath = (startTweetId: string, targetTweetId: string) => {
    const seen = new Set<string>();
    const stack = [startTweetId];
    while (stack.length) {
      const current = stack.pop()!;
      if (current === targetTweetId) return true;
      if (seen.has(current)) continue;
      seen.add(current);
      for (const edge of edges) if (edge.fromTweetId === current) stack.push(edge.toTweetId);
    }
    return false;
  };

  while (pending.length) {
    const current = pending.shift()!;
    for (const declaration of declaredRelations(current.post)) {
      const { relation } = declaration;
      if ("reason" in declaration) {
        omit(current.node.tweetId, relation, declaration.reason, declaration.tweetId);
        continue;
      }
      const { tweetId, expectedAuthor, excerpt } = declaration;
      if (tweetId === current.node.tweetId) {
        omit(current.node.tweetId, relation, "self_reference", tweetId);
        continue;
      }
      if (current.ancestors.has(tweetId)) {
        omit(current.node.tweetId, relation, "cycle", tweetId);
        continue;
      }
      if (current.depth >= MAX_HOPS) {
        omit(current.node.tweetId, relation, "depth_limit", tweetId);
        continue;
      }

      let candidate: TiboEvidencePost | undefined;
      const cached = lookupCache.get(tweetId);
      if (cached) {
        if ("failed" in cached) {
          omit(current.node.tweetId, relation, "lookup_failed", tweetId);
          continue;
        }
        if (cached.rows.length === 0) {
          omit(current.node.tweetId, relation, "not_found", tweetId);
          continue;
        }
        if (cached.rows.length !== 1) {
          omit(current.node.tweetId, relation, "duplicate_candidates", tweetId);
          continue;
        }
        candidate = cached.rows[0];
      } else if (knownPosts.has(tweetId)) {
        const known = knownPosts.get(tweetId)!;
        if (known.node.authorHandle !== expectedAuthor) {
          omit(current.node.tweetId, relation, "author_mismatch", tweetId);
          continue;
        }
        candidate = rawPosts.get(tweetId) ?? {
          tweetId,
          tweetUrl: known.node.tweetUrl,
          text: known.node.text,
          createdAt: known.node.createdAt,
          verificationStatus: "auto_unverified",
        };
      } else {
        if (relatedPosts.length >= MAX_RELATED_POSTS) {
          omit(current.node.tweetId, relation, "related_posts_limit", tweetId);
          continue;
        }
        if (lookupCount >= MAX_RELATED_POST_LOOKUPS) {
          omit(current.node.tweetId, relation, "lookup_limit", tweetId);
          continue;
        }
        lookupCount += 1;
        try {
          const rows = await loadByTweetId(tweetId);
          lookupCache.set(tweetId, { rows });
        } catch {
          lookupCache.set(tweetId, { failed: true });
          omit(current.node.tweetId, relation, "lookup_failed", tweetId);
          continue;
        }
        const result = lookupCache.get(tweetId)!;
        if ("failed" in result) {
          omit(current.node.tweetId, relation, "lookup_failed", tweetId);
          continue;
        }
        if (result.rows.length === 0) {
          omit(current.node.tweetId, relation, "not_found", tweetId);
          continue;
        }
        if (result.rows.length !== 1) {
          omit(current.node.tweetId, relation, "duplicate_candidates", tweetId);
          continue;
        }
        candidate = result.rows[0];
      }

      const candidateValidation = validPost(candidate!, tweetId);
      if (!candidateValidation.valid) {
        omit(current.node.tweetId, relation, candidateValidation.reason, tweetId);
        continue;
      }
      if (candidateValidation.value.node.authorHandle !== expectedAuthor) {
        omit(current.node.tweetId, relation, "author_mismatch", tweetId);
        continue;
      }
      if (candidate.verificationStatus === "rejected") {
        omit(current.node.tweetId, relation, "rejected", tweetId);
        continue;
      }
      if (candidate.verificationStatus !== "auto_unverified" && candidate.verificationStatus !== "confirmed") {
        omit(current.node.tweetId, relation, "unverified", tweetId);
        continue;
      }
      if (!excerptMatches(excerpt, candidate.text)) {
        omit(current.node.tweetId, relation, "text_mismatch", tweetId);
        continue;
      }
      if (candidateValidation.value.createdAtMs > Date.parse(current.node.createdAt)) {
        omit(current.node.tweetId, relation, "future_post", tweetId);
        continue;
      }
      if (candidate.text.length > MAX_RELATED_POST_TEXT_UNITS) {
        omit(current.node.tweetId, relation, "post_body_limit", tweetId);
        continue;
      }

      let known = knownPosts.get(tweetId);
      if (!known) {
        if (relatedPosts.length >= MAX_RELATED_POSTS) {
          omit(current.node.tweetId, relation, "related_posts_limit", tweetId);
          continue;
        }
        if (relatedTextUnits + candidate.text.length > MAX_TOTAL_RELATED_TEXT_UNITS) {
          omit(current.node.tweetId, relation, "total_body_limit", tweetId);
          continue;
        }
        known = candidateValidation.value;
        knownPosts.set(tweetId, known);
        rawPosts.set(tweetId, candidate!);
        relatedPosts.push(known.node);
        relatedTextUnits += candidate.text.length;
      }
      if (hasPath(tweetId, current.node.tweetId)) {
        omit(current.node.tweetId, relation, "cycle", tweetId);
        continue;
      }
      edges.push({ fromTweetId: current.node.tweetId, toTweetId: tweetId, relation });
      if (!visited.has(tweetId) && current.depth + 1 <= MAX_HOPS) {
        visited.add(tweetId);
        const ancestors = new Set(current.ancestors);
        ancestors.add(tweetId);
        pending.push({ post: candidate!, node: known.node, depth: current.depth + 1, ancestors });
      }
    }
  }

  return {
    version: "tibo-evidence-context-v1",
    status: statusFor(relatedPosts, omissions),
    target: targetValidation.value.node,
    relatedPosts,
    edges,
    omissions,
    lookupCount,
  };
}
