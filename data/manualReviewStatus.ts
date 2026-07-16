export type ManualReviewStatusType = "available" | "delayed";

export interface ManualReviewStatus {
  status: ManualReviewStatusType;
  lastCheckedAt: string;
}

export const MANUAL_REVIEW_STATUS: ManualReviewStatus = {
  status: "available",
  lastCheckedAt: "2026-07-16T13:22:00+09:00",
};
