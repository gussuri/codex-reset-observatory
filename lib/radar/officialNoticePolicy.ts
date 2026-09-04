/**
 * Manual policy for official notices whose lifecycle spans more than one
 * observed reset. Notice text is deliberately not inspected here: new
 * persistent notices must be registered explicitly.
 */
export type OfficialNoticeConsumption = "one_shot" | "persistent";

export type OfficialNoticeTermination = {
  endedAt: string;
  sourceTweetId: string;
};

export const PERSISTENT_OFFICIAL_NOTICE_IDS = [
  "2095651088502591861",
] as const;

/** Explicit lifecycle corrections; notice text is never inspected to infer termination. */
export const OFFICIAL_NOTICE_TERMINATIONS: Readonly<Record<string, OfficialNoticeTermination>> = {
  "2095651088502591861": {
    endedAt: "2026-09-04T22:30:29.000Z",
    sourceTweetId: "2096002992046796932",
  },
  "2095979536043401428": {
    endedAt: "2026-09-04T22:30:29.000Z",
    sourceTweetId: "2096002992046796932",
  },
};

const persistentOfficialNoticeIds = new Set<string>(PERSISTENT_OFFICIAL_NOTICE_IDS);
const officialNoticeTerminations = new Map(Object.entries(OFFICIAL_NOTICE_TERMINATIONS));

export function getOfficialNoticeConsumption(
  noticeId: string | null | undefined,
): OfficialNoticeConsumption {
  return typeof noticeId === "string" && persistentOfficialNoticeIds.has(noticeId.trim())
    ? "persistent"
    : "one_shot";
}

export function isOfficialNoticeTerminatedAt(
  noticeId: string | null | undefined,
  now: Date = new Date(),
) {
  if (typeof noticeId !== "string") return false;
  const termination = officialNoticeTerminations.get(noticeId.trim());
  if (!termination) return false;

  const nowTime = now.getTime();
  const endedAt = Date.parse(termination.endedAt);
  return Number.isFinite(nowTime) && Number.isFinite(endedAt) && nowTime >= endedAt;
}
