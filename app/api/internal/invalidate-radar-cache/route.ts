import { createInvalidateRadarCacheHandler } from "@/lib/radar/invalidateRadarCacheRoute";

export const dynamic = "force-dynamic";
export const POST = createInvalidateRadarCacheHandler();
