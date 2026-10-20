import type { TiboContextSafetyInput } from "./tiboContextSafety";
import { getValidatedTiboSameGlobalReplyPath } from "./tiboContextSafety";
import type { TiboEvidenceNode } from "./tiboEvidenceContext";
import {
  isBankedDistributionCompletionSignal,
  isBankedDistributionNotice,
} from "./bankedReset";

export const TIBO_FORMAL_REPLY_ADMISSION_PROOF = Symbol.for(
  "codex-reset-observatory.tibo-formal-reply-admission-proof",
);

export type TiboFormalReplyAdmissionPathNode = Pick<
  TiboEvidenceNode,
  "tweetId" | "tweetUrl" | "authorHandle" | "createdAt"
> & {
  sourceTextHash: string;
  sourceContextRevisionHashes: string[];
};

export type TiboFormalReplyAdmissionMeaningEvidence = {
  tweetId: string;
  quote: string;
  sourceTextHash: string;
};

export type TiboFormalReplyAdmissionProof = {
  version: "tibo-formal-reply-admission-v3";
  admissionMethod: "validated_same_global_reset_reply";
  targetTweetId: string;
  targetTweetUrl: string;
  targetTweetCreatedAt: string;
  targetTextHash: string;
  replyParentTweetId: string;
  contextualResetTweetId: string;
  contextualResetAssessment: "same_global_reset";
  temporalDirection: "completed_now";
  evidenceQuote: string;
  resetMethod: "forced";
  resetMethodEvidence: TiboFormalReplyAdmissionMeaningEvidence;
  resetScope: "all_paid_users" | "all_users";
  resetScopeEvidence: TiboFormalReplyAdmissionMeaningEvidence;
  path: TiboFormalReplyAdmissionPathNode[];
  pathTweetIds: string[];
  pathRelations: Array<"reply">;
  sourceContextRevisionHashes: string[];
  sourceContextGeneration: number;
};

export type TiboFormalReplyAdmissionCarrier = {
  [TIBO_FORMAL_REPLY_ADMISSION_PROOF]?: TiboFormalReplyAdmissionProof | null;
};

export type TiboFormalReplyAdmissionSignal = {
  tweet_id?: unknown;
  text?: unknown;
  tweet_url?: unknown;
  tweet_created_at?: unknown;
  is_reply?: unknown;
  is_quote?: unknown;
  verification_status?: unknown;
  ai_signal_type?: unknown;
  ai_confidence?: unknown;
  ai_classification_status?: unknown;
  ai_temporal_direction?: unknown;
  ai_evidence_quote?: unknown;
  classification_source?: unknown;
  source_context_revision_hashes?: unknown;
  source_context_classified_revision_hashes?: unknown;
  source_context_generation?: unknown;
} & TiboFormalReplyAdmissionCarrier;

const HASH_PATTERN = /^[a-f0-9]{64}$/;
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
] as const;

function rotateRight(value: number, count: number) {
  return (value >>> count) | (value << (32 - count));
}

/** Synchronous SHA-256 without Node-only imports, shared by server and browser history code. */
function sha256Hex(value: string) {
  const input = new TextEncoder().encode(value);
  const paddedLength = Math.ceil((input.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLength);
  padded.set(input);
  padded[input.length] = 0x80;
  const bitLength = input.length * 8;
  for (let index = 0; index < 8; index += 1) {
    padded[paddedLength - 1 - index] = Math.floor(bitLength / (2 ** (index * 8))) & 0xff;
  }

  const hash = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const words = new Uint32Array(64);
  for (let blockOffset = 0; blockOffset < padded.length; blockOffset += 64) {
    for (let index = 0; index < 16; index += 1) {
      const offset = blockOffset + index * 4;
      words[index] = ((padded[offset]! << 24) | (padded[offset + 1]! << 16) |
        (padded[offset + 2]! << 8) | padded[offset + 3]!) >>> 0;
    }
    for (let index = 16; index < 64; index += 1) {
      const x = words[index - 15]!;
      const y = words[index - 2]!;
      const sigma0 = rotateRight(x, 7) ^ rotateRight(x, 18) ^ (x >>> 3);
      const sigma1 = rotateRight(y, 17) ^ rotateRight(y, 19) ^ (y >>> 10);
      words[index] = (words[index - 16]! + sigma0 + words[index - 7]! + sigma1) >>> 0;
    }

    let a = hash[0]!;
    let b = hash[1]!;
    let c = hash[2]!;
    let d = hash[3]!;
    let e = hash[4]!;
    let f = hash[5]!;
    let g = hash[6]!;
    let h = hash[7]!;
    for (let index = 0; index < 64; index += 1) {
      const sum1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temporary1 = (h + sum1 + choose + SHA256_ROUND_CONSTANTS[index]! + words[index]!) >>> 0;
      const sum0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temporary2 = (sum0 + majority) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temporary1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temporary1 + temporary2) >>> 0;
    }
    hash[0] = (hash[0]! + a) >>> 0;
    hash[1] = (hash[1]! + b) >>> 0;
    hash[2] = (hash[2]! + c) >>> 0;
    hash[3] = (hash[3]! + d) >>> 0;
    hash[4] = (hash[4]! + e) >>> 0;
    hash[5] = (hash[5]! + f) >>> 0;
    hash[6] = (hash[6]! + g) >>> 0;
    hash[7] = (hash[7]! + h) >>> 0;
  }
  return Array.from(hash, (part) => part.toString(16).padStart(8, "0")).join("");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function validHashes(value: unknown): value is string[] {
  return Array.isArray(value) && value.length > 0 && value.length <= 3 &&
    value.every((hash) => typeof hash === "string" && HASH_PATTERN.test(hash)) &&
    new Set(value).size === value.length;
}

function tweetIdentity(tweetUrl: string) {
  try {
    const url = new URL(tweetUrl);
    if (url.protocol !== "https:" || !/^(?:x|twitter)\.com$/i.test(url.hostname)
      || url.username || url.password || url.port || url.search || url.hash) return null;
    const match = url.pathname.match(/^\/([A-Za-z0-9_]{1,15})\/status\/(\d+)\/?$/);
    if (!match) return null;
    return {
      tweetId: match[2]!,
      authorHandle: `@${match[1]!.toLowerCase()}`,
      canonicalUrl: `https://x.com/${match[1]!.toLowerCase()}/status/${match[2]}`,
    };
  } catch {
    return null;
  }
}

function parseProof(value: unknown): TiboFormalReplyAdmissionProof | null {
  if (!isObject(value) || value.version !== "tibo-formal-reply-admission-v3"
    || value.admissionMethod !== "validated_same_global_reset_reply"
    || value.contextualResetAssessment !== "same_global_reset"
    || value.temporalDirection !== "completed_now"
    || typeof value.targetTweetId !== "string"
    || typeof value.targetTweetUrl !== "string"
    || typeof value.targetTweetCreatedAt !== "string"
    || typeof value.targetTextHash !== "string"
    || !HASH_PATTERN.test(value.targetTextHash)
    || typeof value.replyParentTweetId !== "string"
    || typeof value.contextualResetTweetId !== "string"
    || typeof value.evidenceQuote !== "string"
    || value.evidenceQuote.length === 0
    || value.evidenceQuote.length > 300
    || value.resetMethod !== "forced"
    || (value.resetScope !== "all_paid_users" && value.resetScope !== "all_users")
    || !isObject(value.resetMethodEvidence)
    || !isObject(value.resetScopeEvidence)
    || !validHashes(value.sourceContextRevisionHashes)
    || !Number.isSafeInteger(value.sourceContextGeneration)
    || (value.sourceContextGeneration as number) < 0
    || !Array.isArray(value.path)
    || value.path.length < 2
    || value.path.length > 3
    || !Array.isArray(value.pathRelations)
    || !Array.isArray(value.pathTweetIds)
    || value.pathTweetIds.some((tweetId) => typeof tweetId !== "string")
    || value.pathRelations.length !== value.path.length - 1
    || value.pathRelations.some((relation) => relation !== "reply")) {
    return null;
  }

  const path: TiboFormalReplyAdmissionPathNode[] = [];
  for (const rawNode of value.path) {
    if (!isObject(rawNode) || typeof rawNode.tweetId !== "string"
      || typeof rawNode.tweetUrl !== "string"
      || typeof rawNode.authorHandle !== "string"
      || typeof rawNode.createdAt !== "string"
      || typeof rawNode.sourceTextHash !== "string"
      || !HASH_PATTERN.test(rawNode.sourceTextHash)
      || !Array.isArray(rawNode.sourceContextRevisionHashes)
      || rawNode.sourceContextRevisionHashes.length > 3
      || rawNode.sourceContextRevisionHashes.some((hash) => typeof hash !== "string" || !HASH_PATTERN.test(hash))) {
      return null;
    }
    path.push({
      tweetId: rawNode.tweetId,
      tweetUrl: rawNode.tweetUrl,
      authorHandle: rawNode.authorHandle,
      createdAt: rawNode.createdAt,
      sourceTextHash: rawNode.sourceTextHash,
      sourceContextRevisionHashes: [...rawNode.sourceContextRevisionHashes] as string[],
    });
  }

  const parseMeaningEvidence = (rawEvidence: Record<string, unknown>) => {
    if (typeof rawEvidence.tweetId !== "string" || typeof rawEvidence.quote !== "string"
      || !rawEvidence.quote.trim() || rawEvidence.quote.length > 300
      || typeof rawEvidence.sourceTextHash !== "string" || !HASH_PATTERN.test(rawEvidence.sourceTextHash)) {
      return null;
    }
    const node = path.find((candidate) => candidate.tweetId === rawEvidence.tweetId);
    if (!node || node.sourceTextHash !== rawEvidence.sourceTextHash) return null;
    return {
      tweetId: rawEvidence.tweetId,
      quote: rawEvidence.quote,
      sourceTextHash: rawEvidence.sourceTextHash,
    };
  };
  const resetMethodEvidence = parseMeaningEvidence(value.resetMethodEvidence);
  const resetScopeEvidence = parseMeaningEvidence(value.resetScopeEvidence);
  if (!resetMethodEvidence || !resetScopeEvidence) return null;

  const targetIdentity = tweetIdentity(value.targetTweetUrl);
  if (!targetIdentity || targetIdentity.tweetId !== value.targetTweetId) return null;
  const pathTweetIds = path.map((node) => node.tweetId);
  if (new Set(pathTweetIds).size !== path.length
    || value.pathTweetIds.length !== pathTweetIds.length
    || value.pathTweetIds.some((tweetId, index) => tweetId !== pathTweetIds[index])) return null;

  return {
    version: "tibo-formal-reply-admission-v3",
    admissionMethod: "validated_same_global_reset_reply",
    targetTweetId: value.targetTweetId,
    targetTweetUrl: targetIdentity.canonicalUrl,
    targetTweetCreatedAt: value.targetTweetCreatedAt,
    targetTextHash: value.targetTextHash,
    replyParentTweetId: value.replyParentTweetId,
    contextualResetTweetId: value.contextualResetTweetId,
    contextualResetAssessment: "same_global_reset",
    temporalDirection: "completed_now",
    evidenceQuote: value.evidenceQuote,
    resetMethod: "forced",
    resetMethodEvidence,
    resetScope: value.resetScope,
    resetScopeEvidence,
    path,
    pathTweetIds,
    pathRelations: value.pathRelations as Array<"reply">,
    sourceContextRevisionHashes: [...value.sourceContextRevisionHashes],
    sourceContextGeneration: value.sourceContextGeneration as number,
  };
}

export function createTiboFormalReplyAdmissionProof(
  input: TiboContextSafetyInput,
  sourceContextRevisionHashes: readonly string[],
  sourceContextGeneration = 0,
): TiboFormalReplyAdmissionProof | null {
  const path = getValidatedTiboSameGlobalReplyPath(input);
  if (!path || !validHashes([...sourceContextRevisionHashes])
    || !Number.isSafeInteger(sourceContextGeneration) || sourceContextGeneration < 0) return null;
  if (input.isReply !== true || input.isQuote === true) return null;
  if (isBankedDistributionCompletionSignal(input.authorText)) return null;
  if (path.some((node) =>
    isBankedDistributionCompletionSignal(node.text) || isBankedDistributionNotice(node.text),
  )) return null;

  const target = path[0]!;
  const normalizedRevisions = [...sourceContextRevisionHashes];
  if (!target.sourceContextRevisionHashes ||
    target.sourceContextRevisionHashes.length !== normalizedRevisions.length ||
    target.sourceContextRevisionHashes.some((hash, index) => hash !== normalizedRevisions[index])) {
    return null;
  }

  const evidenceQuote = input.evidenceQuote?.trim();
  if (!evidenceQuote || evidenceQuote.length > 300 || !input.authorText.includes(evidenceQuote)) return null;

  const meaning = input.resetMeaning;
  if (!meaning || meaning.method !== "forced" ||
    (meaning.scope !== "all_paid_users" && meaning.scope !== "all_users") ||
    !meaning.methodEvidence || !meaning.scopeEvidence) return null;
  const resolveMeaningEvidence = (
    evidence: NonNullable<typeof meaning.methodEvidence>,
  ): TiboFormalReplyAdmissionMeaningEvidence | null => {
    const quote = evidence.quote.trim();
    const node = path.find((candidate) => candidate.tweetId === evidence.tweetId);
    if (!node || !quote || quote.length > 300 || !node.text.includes(quote)) return null;
    return {
      tweetId: node.tweetId,
      quote,
      sourceTextHash: sha256Hex(node.text),
    };
  };
  const resetMethodEvidence = resolveMeaningEvidence(meaning.methodEvidence);
  const resetScopeEvidence = resolveMeaningEvidence(meaning.scopeEvidence);
  if (!resetMethodEvidence || !resetScopeEvidence) return null;

  const proof = {
    version: "tibo-formal-reply-admission-v3" as const,
    admissionMethod: "validated_same_global_reset_reply" as const,
    targetTweetId: target.tweetId,
    targetTweetUrl: target.tweetUrl,
    targetTweetCreatedAt: target.createdAt,
    targetTextHash: sha256Hex(input.authorText),
    replyParentTweetId: path[1]!.tweetId,
    contextualResetTweetId: path.at(-1)!.tweetId,
    contextualResetAssessment: "same_global_reset" as const,
    temporalDirection: "completed_now" as const,
    evidenceQuote,
    resetMethod: "forced" as const,
    resetMethodEvidence,
    resetScope: meaning.scope,
    resetScopeEvidence,
    path: path.map((node) => ({
      tweetId: node.tweetId,
      tweetUrl: node.tweetUrl,
      authorHandle: node.authorHandle,
      createdAt: node.createdAt,
      sourceTextHash: sha256Hex(node.text),
      sourceContextRevisionHashes: node.sourceContextRevisionHashes ?? [],
    })),
    pathTweetIds: path.map((node) => node.tweetId),
    pathRelations: path.slice(1).map(() => "reply" as const),
    sourceContextRevisionHashes: normalizedRevisions,
    sourceContextGeneration,
  };
  return parseProof(proof);
}

/** Remove the database column and carry a valid proof through internal object spreads by symbol. */
export function attachTiboFormalReplyAdmissionProof<T extends Record<string, unknown>>(
  value: T,
  proofValue?: unknown,
): T & TiboFormalReplyAdmissionCarrier {
  const safeValue = { ...value } as T & TiboFormalReplyAdmissionCarrier & Record<string, unknown>;
  const existingSymbolValue = (value as Record<PropertyKey, unknown>)[TIBO_FORMAL_REPLY_ADMISSION_PROOF];
  const parsed = parseProof(proofValue === undefined
    ? value.formal_reply_admission_proof ?? existingSymbolValue
    : proofValue);
  delete safeValue.formal_reply_admission_proof;
  delete safeValue[TIBO_FORMAL_REPLY_ADMISSION_PROOF];
  if (parsed) {
    Object.defineProperty(safeValue, TIBO_FORMAL_REPLY_ADMISSION_PROOF, {
      value: parsed,
      enumerable: true,
      configurable: true,
    });
  }
  return safeValue;
}

export function isTiboFormalReplyAdmissionProofCurrent(
  signal: TiboFormalReplyAdmissionSignal,
) {
  const proof = parseProof(signal[TIBO_FORMAL_REPLY_ADMISSION_PROOF]);
  if (!proof || signal.is_reply !== true || signal.is_quote === true
    || signal.verification_status !== "auto_unverified"
    || isBankedDistributionCompletionSignal(String(signal.text ?? ""))
    || signal.ai_signal_type !== "reset_executed"
    || typeof signal.ai_confidence !== "number"
    || !Number.isFinite(signal.ai_confidence)
    || signal.ai_confidence < 0.95
    || signal.ai_classification_status !== "success"
    || signal.ai_temporal_direction !== "completed_now"
    || typeof signal.ai_evidence_quote !== "string"
    || signal.ai_evidence_quote.trim() !== proof.evidenceQuote
    || signal.classification_source !== "gemini"
    || typeof signal.tweet_id !== "string"
    || typeof signal.text !== "string"
    || typeof signal.tweet_url !== "string"
    || typeof signal.tweet_created_at !== "string"
    || !validHashes(signal.source_context_revision_hashes)
    || !validHashes(signal.source_context_classified_revision_hashes)
    || !Number.isSafeInteger(signal.source_context_generation)
    || (signal.source_context_generation as number) < 0
    || signal.source_context_generation !== proof.sourceContextGeneration) {
    return false;
  }

  const currentSourceRevisionHashes = signal.source_context_revision_hashes;
  const classifiedRevisionHashes = signal.source_context_classified_revision_hashes;
  const signalIdentity = tweetIdentity(signal.tweet_url);
  const proofIdentity = tweetIdentity(proof.targetTweetUrl);

  if (proof.targetTweetId !== signal.tweet_id
    || signalIdentity?.tweetId !== proofIdentity?.tweetId
    || signalIdentity?.authorHandle !== proofIdentity?.authorHandle
    || Date.parse(proof.targetTweetCreatedAt) !== Date.parse(signal.tweet_created_at)
    || sha256Hex(signal.text) !== proof.targetTextHash
    || !signal.text.includes(proof.evidenceQuote)) {
    return false;
  }
  if (proof.sourceContextRevisionHashes.length !== currentSourceRevisionHashes.length
    || proof.sourceContextRevisionHashes.some((hash, index) => hash !== currentSourceRevisionHashes[index])
    || proof.sourceContextRevisionHashes.some((hash) => !classifiedRevisionHashes.includes(hash))) {
    return false;
  }

  const first = proof.path[0]!;
  const firstIdentity = tweetIdentity(first.tweetUrl);
  if (first.tweetId !== signal.tweet_id || first.tweetUrl !== proof.targetTweetUrl
    || first.authorHandle !== "@thsottiaux"
    || !firstIdentity || firstIdentity.tweetId !== first.tweetId || firstIdentity.authorHandle !== first.authorHandle
    || Date.parse(first.createdAt) !== Date.parse(signal.tweet_created_at)
    || first.sourceTextHash !== proof.targetTextHash
    || first.sourceContextRevisionHashes.length !== proof.sourceContextRevisionHashes.length
    || first.sourceContextRevisionHashes.some((hash, index) => hash !== proof.sourceContextRevisionHashes[index])) {
    return false;
  }

  for (let index = 0; index < proof.path.length; index += 1) {
    const node = proof.path[index]!;
    const identity = tweetIdentity(node.tweetUrl);
    const createdAt = Date.parse(node.createdAt);
    if (!identity || identity.tweetId !== node.tweetId || identity.authorHandle !== node.authorHandle
      || node.authorHandle !== "@thsottiaux" || !Number.isFinite(createdAt)) return false;
    if (index > 0 && createdAt >= Date.parse(proof.path[index - 1]!.createdAt)) return false;
  }

  return proof.path[1]!.tweetId === proof.replyParentTweetId &&
    proof.contextualResetTweetId === proof.path.at(-1)!.tweetId &&
    proof.pathRelations.length === proof.path.length - 1 &&
    proof.pathRelations.every((relation) => relation === "reply");
}

export function getCurrentTiboFormalReplyAdmissionProof(
  signal: TiboFormalReplyAdmissionSignal,
) {
  return isTiboFormalReplyAdmissionProofCurrent(signal)
    ? parseProof(signal[TIBO_FORMAL_REPLY_ADMISSION_PROOF])
    : null;
}
