import { NextRequest, NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { classifyTiboTweet } from "@/lib/radar/classification";

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

    // Ensure status URL belongs to @thsottiaux profile path
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

    // Require tweetCreatedAt
    if (!tweetCreatedAt || typeof tweetCreatedAt !== "string") {
      return NextResponse.json({ error: "tweetCreatedAt is required" }, { status: 400 });
    }

    const createdDate = new Date(tweetCreatedAt);
    const nowTime = Date.now();

    if (isNaN(createdDate.getTime())) {
      return NextResponse.json({ error: "Invalid tweetCreatedAt date format" }, { status: 400 });
    }

    // Reject timestamps more than 5 minutes in the future
    if (createdDate.getTime() > nowTime + 5 * 60 * 1000) {
      return NextResponse.json(
        { error: "Invalid tweetCreatedAt: Timestamp is more than 5 minutes in the future" },
        { status: 400 }
      );
    }

    // 3. Classification Engine
    const classification = classifyTiboTweet(text, tweetUrl);

    // 4. Calculate Expiration based on tweet_created_at
    const expiresAt = new Date(createdDate.getTime() + 24 * 60 * 60 * 1000);

    const payload = {
      tweet_id: tweetId,
      signal_type: classification.signalType,
      text: text.trim(),
      tweet_url: tweetUrl,
      tweet_created_at: createdDate.toISOString(),
      detected_at: new Date().toISOString(),
      expires_at: expiresAt.toISOString(),
      verification_status: "auto_unverified",
      confidence: classification.confidence,
      classification_reason: classification.reason,
      is_reply: classification.isReply,
      is_quote: classification.isQuote,
    };

    // 5. Supabase Upsert with ignoreDuplicates
    const supabase = getSupabaseServiceClient();
    const { error } = await supabase
      .from("tibo_signals")
      .upsert(payload, { onConflict: "tweet_id", ignoreDuplicates: true });

    if (error) {
      console.error("[Webhook Error] Supabase upsert failed:", error);
      return NextResponse.json({ error: "Database error" }, { status: 500 });
    }

    // 6. Purge Next.js SSR Cache
    try {
      revalidateTag("radar-data");
    } catch (e) {
      console.warn("[Webhook Warning] Cache revalidation skipped:", e);
    }

    return NextResponse.json({
      success: true,
      signalType: classification.signalType,
      confidence: classification.confidence,
    });
  } catch (err: any) {
    console.error("[Webhook Error]", err);
    return NextResponse.json({ error: err.message || "Internal Error" }, { status: 500 });
  }
}
