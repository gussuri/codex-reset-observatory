import { invalidateRadarCache } from "./cacheInvalidation";

export type FutureReplyCacheInvalidation = {
  event_key: string;
  reply_tweet_id: string;
  recovery_observed_at: string;
  reset_event_key: string;
};

type AcknowledgeFutureReplyCacheInvalidation = (
  pending: FutureReplyCacheInvalidation,
) => PromiseLike<{ data: unknown; error: unknown }>;

export async function finishFutureReplyCacheInvalidation(
  pending: FutureReplyCacheInvalidation,
  acknowledge: AcknowledgeFutureReplyCacheInvalidation,
  invalidate: typeof invalidateRadarCache = invalidateRadarCache,
) {
  try {
    await invalidate("tibo-event");
  } catch {
    return false;
  }

  const response = await acknowledge(pending);
  if (response.error) return false;
  const result = response.data && typeof response.data === "object" && !Array.isArray(response.data)
    ? response.data as Record<string, unknown>
    : null;
  return result?.status === "acknowledged" || result?.status === "already_acknowledged";
}
