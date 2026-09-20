import { createTiboTranslationReconciliationHandler } from "../../../../lib/radar/tiboTranslationReconciliationRoute";

export const dynamic = "force-dynamic";

const handler = createTiboTranslationReconciliationHandler();
export const GET = handler;
export const POST = handler;
