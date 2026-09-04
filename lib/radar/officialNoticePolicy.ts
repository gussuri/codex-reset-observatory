/**
 * Manual policy for official notices whose lifecycle spans more than one
 * observed reset. Notice text is deliberately not inspected here: new
 * persistent notices must be registered explicitly.
 */
export type OfficialNoticeConsumption = "one_shot" | "persistent";

export const PERSISTENT_OFFICIAL_NOTICE_IDS = [
  "2095651088502591861",
] as const;

const persistentOfficialNoticeIds = new Set<string>(PERSISTENT_OFFICIAL_NOTICE_IDS);

export function getOfficialNoticeConsumption(
  noticeId: string | null | undefined,
): OfficialNoticeConsumption {
  return typeof noticeId === "string" && persistentOfficialNoticeIds.has(noticeId.trim())
    ? "persistent"
    : "one_shot";
}
