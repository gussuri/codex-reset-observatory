import { revalidateTag } from "next/cache";

import { isBearerAuthorizationValid } from "../security/bearerAuth";
import {
  getTiboTranslationServiceClient,
  listMissingTiboTranslations,
  reconcileMissingTiboTranslations,
  TIBO_TRANSLATION_REPAIR_AUDIT_LIMIT,
  TIBO_TRANSLATION_REPAIR_BATCH_SIZE,
  type MissingTiboTranslationRow,
  type TiboTranslationRepairResult,
  type TiboTranslationReconciliationOptions,
  type TiboTranslationStoreClient,
} from "./tiboTranslationReconciliation";

type StoreFactory = () => TiboTranslationStoreClient;
type AuditRunner = (
  store: TiboTranslationStoreClient,
  limit: number,
) => Promise<MissingTiboTranslationRow[]>;
type RepairRunner = (
  options: TiboTranslationReconciliationOptions,
) => Promise<TiboTranslationRepairResult>;
type InvalidateRadarData = () => void | Promise<void>;

function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/json",
    },
  });
}

function readLimit(request: Request, fallback: number) {
  const value = Number(new URL(request.url).searchParams.get("limit"));
  if (!Number.isFinite(value)) return fallback;
  return Math.min(TIBO_TRANSLATION_REPAIR_AUDIT_LIMIT, Math.max(1, Math.floor(value)));
}

function summarizeRepair(result: TiboTranslationRepairResult) {
  const statusSummary: Record<string, number> = {};
  for (const outcome of result.outcomes) {
    statusSummary[outcome.status] = (statusSummary[outcome.status] ?? 0) + 1;
  }
  return {
    status: "completed",
    scanned: result.scanned,
    candidates: result.candidates,
    attempted: result.attempted,
    geminiRequests: result.geminiRequests,
    writes: result.writes,
    rateLimited: result.rateLimited,
    invalidated: result.invalidated,
    statusSummary: Object.fromEntries(
      Object.entries(statusSummary).sort(([left], [right]) => left.localeCompare(right)),
    ),
  };
}

export function createTiboTranslationReconciliationHandler(
  storeFactory: StoreFactory = getTiboTranslationServiceClient,
  auditRunner: AuditRunner = listMissingTiboTranslations,
  repairRunner: RepairRunner = reconcileMissingTiboTranslations,
  invalidateRadarData: InvalidateRadarData = () => revalidateTag("radar-data"),
) {
  return async function handle(request: Request) {
    const expectedSecret = process.env.CRON_SECRET?.trim();
    if (!expectedSecret) return response({ error: "configuration_unavailable" }, 503);
    if (!isBearerAuthorizationValid(request.headers.get("authorization"), expectedSecret)) {
      return response({ error: "Unauthorized" }, 401);
    }

    try {
      const store = storeFactory();
      if (request.method === "GET") {
        const rows = await auditRunner(store, readLimit(request, TIBO_TRANSLATION_REPAIR_AUDIT_LIMIT));
        return response({
          status: "dry_run",
          scanned: rows.length,
          candidates: rows.map((row) => ({
            tweetId: row.tweetId,
            signalType: row.signalType,
            missingLocales: [
              row.translatedTextJa ? null : "ja",
              row.translatedTextZh ? null : "zh",
            ].filter((locale): locale is string => Boolean(locale)),
          })),
        }, 200);
      }

      if (request.method !== "POST") return response({ error: "Method Not Allowed" }, 405);

      const result = await repairRunner({
        store,
        maxRows: TIBO_TRANSLATION_REPAIR_BATCH_SIZE,
        invalidateRadarData,
      });
      return response(summarizeRepair(result), 200);
    } catch {
      return response({ status: "error", error: "reconciliation_failed" }, 500);
    }
  };
}
