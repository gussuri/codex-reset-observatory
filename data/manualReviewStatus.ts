export type ManualReviewStatusType = "available" | "delayed";

export interface ManualReviewStatus {
  status: ManualReviewStatusType;
  lastCheckedAt: string;
}

export const MANUAL_REVIEW_STATUS: ManualReviewStatus = {
  status: "delayed",
  lastCheckedAt: "2026-07-16T03:00:00+09:00",
};
