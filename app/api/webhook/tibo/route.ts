import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { classifyTiboTweet } from "@/lib/radar/classification";
import { classifyWithGemini } from "@/lib/radar/geminiClassification";
import {
  buildTiboClassificationResponse,
  normalizeTiboClassificationMode,
  selectTiboClassification,
  shouldRunGeminiClassification,
} from "@/lib/radar/tiboClassificationMode";

function getSupabaseServiceClient() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !supabaseServiceRoleKey) {
    throw new Error("Missing Supabase Service Role configuration.");
  }
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: { persistSession: false },
  });
}

export async function POST(req: NextRequest) {
  try {
    // 1. Fail closed if TIBO_WEBHOOK_SECRET is not configured
    const expectedSecret = process.env.TIBO_WEBHOOK_SECRET;
    if (!expectedSecret) {
      return NextResponse.json(
        { error: "Server Configuration Error: TIBO_WEBHOOK_SECRET is not configured." },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get("authorization");
    const token = authHeader?.replace(/^Bearer\s+/i, "");

    if (!token || token !== expectedSecret) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await req.json();
    const { tweetId, text, tweetUrl, tweetCreatedAt } = body;

    // 2. Strict Input Validation
    if (!tweetId || typeof tweetId !== "string" || !/^\d+$/.test(tweetId)) {
      return NextResponse.json({ error: "Invalid tweetId" }, { status: 400 });
    }

    if (!text || typeof text !== "string" || text.length > 2000) {
      return NextResponse.json({ error: "Invalid text" }, { status: 400 });
    }

    if (
      !tweetUrl ||
      typeof tweetUrl !== "string" ||
      !/^https:\/\/(x|twitter)\.com\/thsottiaux\/status\/\d+/i.test(tweetUrl)
    ) {
      return NextResponse.json(
        { error: "Invalid tweetUrl: Must belong to @thsottiaux status path" },
        { status: 400 }
      );
    }

    if (!tweetCreatedAt || typeof tweetCreatedAt !== "string") {
      return NextResponse.json({ error: "tweetCreatedAt is required" }, { status: 400 });
    }

    const createdDate = new Date(tweetCreatedAt);
    const nowTime = Date.now();

    if (isNaN(createdDate.getTime())) {
      return NextResponse.json({ error: "Invalid tweetCreatedAt date format" }, { status: 400 });
    }

    if (createdDate.getTime() > nowTime + 5 * 60 * 1000) {
      return NextResponse.json(
        { error: "Invalid tweetCreatedAt: Timestamp is more than 5 minutes in the future" },
        { status: 400 }
      );
    }

    // 3. Existing Rule Classification
    const ruleResult = classifyTiboTweet(text, tweetUrl);

    // 4. Gemini Classification (Optional based on GEMINI_CLASSIFICATION_MODE)
    const mode = normalizeTiboClassificationMode(process.env.GEMINI_CLASSIFICATION_MODE);

    let aiResult = null;
    if (shouldRunGeminiClassification(mode)) {
      try {
        aiResult = await classifyWithGemini({ text, tweetCreatedAt }, { mode });
      } catch {
        // Keep the webhook successful and let primary mode select the rule fallback.
        console.warn("[Webhook Warning] Gemini classification failed; using the rule fallback.");
        aiResult = {
          signalType: null,
          confidence: null,
          temporalDirection: null,
          evidenceQuote: null,
          reasonJa: null,
          resetTypeJa: null,
          noticeToExecution: null,
          model: process.env.GEMINI_MODEL || null,
          status: "api_error" as const,
          classifiedAt: new Date().toISOString(),
        };
      }
    }

    const selectedClassification = selectTiboClassification(mode, ruleResult, aiResult);
    const classificationResponse = buildTiboClassificationResponse(mode, ruleResult, aiResult);

    // 5. Expiration Calculation based on tweet_created_at
    const expiresAt = new Date(createdDate.getTime() + 24 * 60 * 60 * 1000);

    // 6. Build Supabase Payload
    const payload = {
      tweet_id: tweetId,
      signal_type: selectedClassification.signalType,
      confidence: selectedClassification.confidence,
      text: text.trim(),
      tweet_url: tweetUrl,
      tweet_created_at: createdDate.toISOString(),
      detected_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      verification_status: "auto_unverified",
      classification_reason: selectedClassification.reason,
      is_reply: ruleResult.isReply,
      is_quote: ruleResult.isQuote,

      // Audit columns
      rule_signal_type: ruleResult.signalType,
      rule_confidence: ruleResult.confidence,
      ai_signal_type: aiResult?.signalType ?? null,
      ai_confidence: aiResult?.confidence ?? null,
      ai_temporal_direction: aiResult?.temporalDirection || null,
      ai_evidence_quote: aiResult?.evidenceQuote || null,
      ai_reason_ja: aiResult?.reasonJa || null,
      ai_reset_type_ja: aiResult?.resetTypeJa || null,
      ai_notice_to_execution: aiResult?.noticeToExecution || null,
      ai_model: aiResult?.model || null,
      ai_classification_status: aiResult?.status || "skipped",
      ai_classified_at: aiResult?.classifiedAt || null,
      classification_source: selectedClassification.classificationSource,
    };

    // 7. Supabase Upsert
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("tibo_signals")
      .upsert(payload, { onConflict: "tweet_id" });

    if (error) {
      console.error("[Webhook Error] Supabase upsert failed:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 8. Purge Next.js Cache
    try {
      revalidateTag("radar-data");
    } catch (e) {
      console.warn("[Webhook Warning] Cache revalidation skipped:", e);
    }

    return NextResponse.json({ success: true, ...classificationResponse });
  } catch {
    console.error("[Webhook Error] Request processing failed.");
    return NextResponse.json({ error: "Internal Error" }, { status: 500 });
  }
}
