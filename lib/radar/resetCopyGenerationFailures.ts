const FAILURE_INPUT_HASHES_FLAG = "generation-failure-input-hashes-v1:";
const MAX_FAILURE_INPUT_HASHES = 8;
const INPUT_HASH_PATTERN = /^[a-f0-9]{64}$/;

function readFailureInputHashes(flags: readonly string[] | null | undefined) {
  const marker = flags?.find((flag) => flag.startsWith(FAILURE_INPUT_HASHES_FLAG));
  if (!marker) return [];
  try {
    const value: unknown = JSON.parse(marker.slice(FAILURE_INPUT_HASHES_FLAG.length));
    if (!Array.isArray(value)) return [];
    return value.filter((hash): hash is string =>
      typeof hash === "string" && INPUT_HASH_PATTERN.test(hash),
    ).slice(-MAX_FAILURE_INPUT_HASHES);
  } catch {
    return [];
  }
}

export function hasResetCopyGenerationFailure(
  flags: readonly string[] | null | undefined,
  inputHash: string,
) {
  return readFailureInputHashes(flags).includes(inputHash);
}

export function recordResetCopyGenerationFailure(
  flags: readonly string[] | null | undefined,
  inputHash: string,
) {
  const preservedFlags = (flags ?? []).filter((flag) => !flag.startsWith(FAILURE_INPUT_HASHES_FLAG));
  const hashes = Array.from(new Set([...readFailureInputHashes(flags), inputHash]))
    .slice(-MAX_FAILURE_INPUT_HASHES);
  return [...preservedFlags, `${FAILURE_INPUT_HASHES_FLAG}${JSON.stringify(hashes)}`];
}

export function preserveResetCopyGenerationFailureFlags(
  flags: readonly string[] | null | undefined,
  sourceFlags: readonly string[] | null | undefined,
) {
  const retainedMarker = sourceFlags?.find((flag) => flag.startsWith(FAILURE_INPUT_HASHES_FLAG));
  const result = (flags ?? []).filter((flag) => !flag.startsWith(FAILURE_INPUT_HASHES_FLAG));
  return retainedMarker ? [...result, retainedMarker] : result;
}
