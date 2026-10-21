import assert from "node:assert/strict";
import test from "node:test";

import { createClient } from "@supabase/supabase-js";

const localUrl = process.env.SUPABASE_LOCAL_URL;
const localServiceRoleKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;
const localIntegrationMarker = process.env.SUPABASE_LOCAL_INTEGRATION === "1";
const localUrlHost = (() => {
  if (!localUrl) return null;
  try {
    return new URL(localUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
})();
const loopbackHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
const hasAnyLocalConfiguration = Boolean(localUrl || localServiceRoleKey || localIntegrationMarker);
if (hasAnyLocalConfiguration && (
  !localIntegrationMarker ||
  !localUrl ||
  !localServiceRoleKey ||
  !localUrlHost ||
  !loopbackHosts.has(localUrlHost)
)) {
  throw new Error("Gemini failure diagnostic database tests require an explicit local integration marker and loopback Supabase URL");
}
const isConfigured = localIntegrationMarker && Boolean(localUrl && localServiceRoleKey);

test("loopback Supabase stores and clears bounded Tibo Gemini diagnostics", {
  skip: !isConfigured,
}, async () => {
  const tweetId = "2119999000000010101";
  const client = createClient(localUrl!, localServiceRoleKey!, {
    auth: { persistSession: false },
  });
  const diagnostics = [
    { category: "provider_server", httpStatus: 503 },
    { category: "rate_limit", httpStatus: 429 },
  ];

  try {
    await client.from("tibo_signals").delete().eq("tweet_id", tweetId);
    const { error: insertError } = await client.from("tibo_signals").insert({
      tweet_id: tweetId,
      signal_type: "irrelevant",
      text: "Local integration fixture.",
      tweet_url: `https://x.com/thsottiaux/status/${tweetId}`,
      tweet_created_at: "2026-10-20T00:00:00.000Z",
      detected_at: "2026-10-20T00:00:00.000Z",
      expires_at: "2026-10-21T00:00:00.000Z",
      ai_classification_status: "api_error",
      ai_failure_diagnostics: diagnostics,
    });
    assert.ifError(insertError);

    const { data, error: readError } = await client.from("tibo_signals")
      .select("ai_classification_status,ai_failure_diagnostics")
      .eq("tweet_id", tweetId)
      .single();
    assert.ifError(readError);
    assert.equal(data?.ai_classification_status, "api_error");
    assert.deepEqual(data?.ai_failure_diagnostics, diagnostics);

    const { error: oversizedError } = await client.from("tibo_signals")
      .update({ ai_failure_diagnostics: [...diagnostics, { category: "timeout", httpStatus: null }] })
      .eq("tweet_id", tweetId);
    assert.ok(oversizedError, "the database must reject more than two attempt diagnostics");

    const { error: clearError } = await client.from("tibo_signals")
      .update({ ai_classification_status: "success", ai_failure_diagnostics: null })
      .eq("tweet_id", tweetId);
    assert.ifError(clearError);
    const { data: cleared, error: clearedReadError } = await client.from("tibo_signals")
      .select("ai_classification_status,ai_failure_diagnostics")
      .eq("tweet_id", tweetId)
      .single();
    assert.ifError(clearedReadError);
    assert.equal(cleared?.ai_classification_status, "success");
    assert.equal(cleared?.ai_failure_diagnostics, null);
  } finally {
    const { error } = await client.from("tibo_signals").delete().eq("tweet_id", tweetId);
    assert.ifError(error);
  }
});
