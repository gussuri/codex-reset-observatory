import { isBearerAuthorizationValid } from "../security/bearerAuth";
import {
  reconcileCodexUsageBankedGrantAssociations,
} from "../codexUsageBankedAssociationReconciliation";
import type { BankedGrantAssociationReconciliationResult } from "../codexUsageBankedAssociationReconciliation";

export type BankedGrantAssociationReconcileRunner = () => Promise<BankedGrantAssociationReconciliationResult>;

export function toSafeBankedGrantAssociationReconciliationResponse(
  result: BankedGrantAssociationReconciliationResult,
) {
  return {
    status: result.failed > 0 ? "failed" : "completed",
    scanned: result.scanned,
    accepted: result.accepted,
    pending: result.pending,
    conflict: result.conflict,
    stale: result.stale,
    failed: result.failed,
    invalidated: result.invalidated,
    hasMore: result.hasMore,
  };
}

function json(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/json",
    },
  });
}

export function createReconcileBankedGrantAssociationsHandler(
  runner: BankedGrantAssociationReconcileRunner = () =>
    reconcileCodexUsageBankedGrantAssociations(),
) {
  return async function post(request: Request) {
    const secret = process.env.CRON_SECRET?.trim();
    if (!secret) return json({ error: "configuration_unavailable" }, 503);
    if (!isBearerAuthorizationValid(request.headers.get("authorization"), secret)) {
      return json({ error: "Unauthorized" }, 401);
    }
    try {
      const result = await runner();
      return json(
        result.failed > 0
          ? { ...toSafeBankedGrantAssociationReconciliationResponse(result), error: "reconciliation_failed" }
          : toSafeBankedGrantAssociationReconciliationResponse(result),
        result.failed > 0 ? 503 : 200,
      );
    } catch {
      return json({ error: "reconciliation_failed" }, 500);
    }
  };
}
