import { isBearerAuthorizationValid } from "../security/bearerAuth";
import {
  getRadarCacheInvalidationTags,
  invalidateRadarCache,
  type RadarCacheInvalidationScope,
} from "./cacheInvalidation";

export const ALLOWED_RADAR_CACHE_INVALIDATION_SCOPES: readonly RadarCacheInvalidationScope[] = [
  "tibo",
  "tibo-event",
  "codex-usage",
  "display-names",
  "prediction-history",
  "all",
] as const;

export function isAllowedRadarCacheInvalidationScope(
  value: unknown,
): value is RadarCacheInvalidationScope {
  return (
    typeof value === "string" &&
    (ALLOWED_RADAR_CACHE_INVALIDATION_SCOPES as readonly string[]).includes(value)
  );
}

type InvalidateRadarData = (scope: RadarCacheInvalidationScope) => void | Promise<void>;
type SecretProvider = () => string | undefined;

function response(body: unknown, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Cache-Control": "no-store, no-cache, must-revalidate",
      "Content-Type": "application/json",
    },
  });
}

export function createInvalidateRadarCacheHandler(
  invalidate: InvalidateRadarData = invalidateRadarCache,
  getExpectedSecret: SecretProvider = () => process.env.CRON_SECRET?.trim(),
) {
  return async function handle(request: Request) {
    if (request.method !== "POST") {
      return response({ error: "Method Not Allowed" }, 405);
    }

    const expectedSecret = getExpectedSecret();
    if (!expectedSecret) {
      return response({ error: "configuration_unavailable" }, 503);
    }

    if (!isBearerAuthorizationValid(request.headers.get("authorization"), expectedSecret)) {
      return response({ error: "Unauthorized" }, 401);
    }

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return response({ error: "invalid_payload" }, 400);
    }

    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return response({ error: "invalid_payload" }, 400);
    }

    const scope = (payload as Record<string, unknown>).scope;
    if (!isAllowedRadarCacheInvalidationScope(scope)) {
      return response({ error: "invalid_scope" }, 400);
    }

    try {
      await invalidate(scope);
      const invalidatedTags = getRadarCacheInvalidationTags(scope);
      return response(
        {
          status: "completed",
          scope,
          invalidatedTags,
        },
        200,
      );
    } catch {
      return response({ status: "error", error: "invalidation_failed" }, 500);
    }
  };
}
