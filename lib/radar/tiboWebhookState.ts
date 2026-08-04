import type { TiboVerificationStatus } from "./tiboHistory";

export type ExistingTiboWebhookState = {
  detected_at?: string | null;
  verification_status?: TiboVerificationStatus | null;
};

type TiboWebhookPayload = {
  detected_at: string;
  verification_status: TiboVerificationStatus;
};

export function preserveTiboWebhookState<T extends TiboWebhookPayload>(
  payload: T,
  existing: ExistingTiboWebhookState | null | undefined,
  receivedAt: string,
): T {
  return {
    ...payload,
    detected_at: existing?.detected_at ?? receivedAt,
    verification_status: existing?.verification_status ?? "auto_unverified",
  } as T;
}
