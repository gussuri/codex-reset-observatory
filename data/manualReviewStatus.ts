export type ManualReviewStatusType = "available" | "delayed";

export interface ManualReviewStatus {
  status: ManualReviewStatusType;
  lastCheckedAt: string;
}

export const MANUAL_REVIEW_STATUS: ManualReviewStatus = {
  status: "delayed",
  lastCheckedAt: "03:00 JST",
};
