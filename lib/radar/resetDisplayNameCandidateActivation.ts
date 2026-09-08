import type {
  ResetDisplayNameCandidateActivation,
  ResetDisplayNameCandidateActivationMode,
} from "./resetDisplayNameCandidateTypes";

const MODE_ENV = "RESET_DISPLAY_NAME_CANDIDATE_MODE";
const ADOPTION_AT_ENV = "RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT";

function isValidIsoTimestamp(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

export function readResetDisplayNameCandidateActivation(
  env: Readonly<Record<string, string | undefined>>,
): ResetDisplayNameCandidateActivation {
  const rawMode = env[MODE_ENV]?.trim();
  const mode: ResetDisplayNameCandidateActivationMode | undefined =
    rawMode === "off" || rawMode === "seed" || rawMode === "full" ? rawMode : undefined;

  if (!mode || mode === "off") return { mode: "off", adoptionAt: null };

  const adoptionAt = env[ADOPTION_AT_ENV];
  return isValidIsoTimestamp(adoptionAt)
    ? { mode, adoptionAt }
    : { mode: "off", adoptionAt: null };
}

export function isResetDisplayNameCandidateNoticeAfterAdoption(
  tweetCreatedAt: string,
  adoptionAt: string,
): boolean {
  const tweetTime = Date.parse(tweetCreatedAt);
  const adoptionTime = Date.parse(adoptionAt);
  return Number.isFinite(tweetTime) && Number.isFinite(adoptionTime) && tweetTime >= adoptionTime;
}
