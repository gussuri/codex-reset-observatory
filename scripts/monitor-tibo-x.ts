import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const TARGET_HANDLE = "thsottiaux";
const SYNDICATION_URL = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${TARGET_HANDLE}`;
const PROCESSED_STATE_FILE = path.join(process.cwd(), "data", "processedTweets.json");
const SIGNALS_FILE = path.join(process.cwd(), "data", "observationSignals.ts");
const HISTORY_FILE = path.join(process.cwd(), "data", "resetHistory.ts");

// 極端に低い異常スコア (0.60未満) の場合のみ安全ガードとしてスキップ
const SAFETY_MIN_CONFIDENCE = 0.60;

type ClassificationResult = {
  category: "RESET_COMPLETED" | "OFFICIAL_NOTICE" | "TEASER_HINT" | "TEASER_RESOLVED_BY_FEATURE" | "IRRELEVANT";
  confidence: number;
  reason_ja: string;
  reset_title_ja?: string;
  reset_type_ja?: "ご祝儀リセット" | "詫びリセット" | "定期リセット" | "ランダムリセット";
  notice_to_execution?: string;
  key_phrase?: string;
  parsed_notice_time?: string | null;
  resolved_feature_summary_ja?: string;
};

type TweetItem = {
  id: string;
  createdAt: string;
  text: string;
  url: string;
};

type ProcessedState = {
  lastProcessedTweetId: string;
  processedTweetIds: string[];
};

function readState(): ProcessedState {
  try {
    if (fs.existsSync(PROCESSED_STATE_FILE)) {
      const raw = fs.readFileSync(PROCESSED_STATE_FILE, "utf-8");
      return JSON.parse(raw);
    }
  } catch (err) {
    console.warn("Warning: Could not read processedTweets.json, using default empty state.");
  }
  return { lastProcessedTweetId: "", processedTweetIds: [] };
}

function saveState(state: ProcessedState) {
  try {
    fs.writeFileSync(PROCESSED_STATE_FILE, JSON.stringify(state, null, 2), "utf-8");
  } catch (err) {
    console.error("Error saving processedTweets.json:", err);
  }
}

function fetchSyndicationHtml(): Promise<string> {
  return new Promise((resolve, reject) => {
    const req = https.get(
      SYNDICATION_URL,
      {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        },
        timeout: 10000,
      },
      (res) => {
        if (res.statusCode !== 200) {
          reject(new Error(`Twitter Syndication returned HTTP ${res.statusCode}`));
          return;
        }
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error("Twitter Syndication request timed out (10s)"));
    });
    req.on("error", reject);
  });
}

function extractTweetsFromHtml(html: string): TweetItem[] {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    throw new Error("Could not find __NEXT_DATA__ script in Twitter Syndication HTML");
  }

  const jsonData = JSON.parse(match[1]);
  const entries = jsonData?.props?.pageProps?.timeline?.entries || [];
  const tweets: TweetItem[] = [];

  for (const entry of entries) {
    const tweet = entry?.content?.tweet;
    if (tweet && tweet.id_str) {
      tweets.push({
        id: tweet.id_str,
        createdAt: tweet.created_at,
        text: (tweet.full_text || tweet.text || "").trim(),
        url: `https://x.com/${TARGET_HANDLE}/status/${tweet.id_str}`,
      });
    }
  }

  return tweets;
}

const SYSTEM_PROMPT = `
You are an AI classifier for an automated Codex Reset Observatory system.
You analyze tweets from Tibo (@thsottiaux), an OpenAI engineer leading the Codex team.

Classify each tweet into EXACTLY ONE of the following 5 categories:
1. "RESET_COMPLETED": Statement confirming that a rate limit reset HAS ALREADY BEEN COMPLETED or IS NOW EFFECTIVE (e.g., "we have reset the rate limits", "limits are reset", "outage resolved and limits reset").
2. "OFFICIAL_NOTICE": Statement that rate limits ARE SCHEDULED to be reset at a specific future time/window.
3. "TEASER_RESOLVED_BY_FEATURE": A statement announcing a major new feature, UI update, model release, or survey (e.g. "Voice is live", "Canvas is now available", "Model updated to gpt-4o-mini", "IDE survey") that follows or relates to a previous teaser/fun statement WITHOUT resetting usage rate limits yet.
4. "TEASER_HINT": A hint, teaser, or ambiguous statement strongly suggesting an upcoming reset, global usage refresh, or "fun week/recharge" teaser within 24-48 hours.
5. "IRRELEVANT": Regular chatter, general small updates without limit resets, surveys without previous teasers, outage investigation without resets, or explicit statements denying a reset.

Respond ONLY with valid JSON in this exact structure:
{
  "category": "RESET_COMPLETED" | "OFFICIAL_NOTICE" | "TEASER_RESOLVED_BY_FEATURE" | "TEASER_HINT" | "IRRELEVANT",
  "confidence": number,
  "reason_ja": "判別理由（日本語で分かりやすく説明）",
  "reset_title_ja": "リセット完了時のタイトル（COMPLETED時のみ必須、それ以外はnull）",
  "reset_type_ja": "ご祝儀リセット" | "詫びリセット" | "定期リセット" | "ランダムリセット",
  "notice_to_execution": "告知から実施までの時間表現",
  "key_phrase": "判定の決め手となったキーワードまたはフレーズ",
  "resolved_feature_summary_ja": "どのような新機能・アプデ発表であったか（TEASER_RESOLVED_BY_FEATURE時のみ記述、それ以外はnull）"
}
`;

const CANDIDATE_MODELS = [
  "gemini-2.0-flash",
  "gemini-flash-latest",
  "gemini-2.0-flash-lite",
  "gemini-1.5-flash-latest",
  "gemini-pro-latest",
];

async function callSingleModel(modelName: string, tweetText: string, apiKey: string): Promise<ClassificationResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
  const payload = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
          { text: `Tweet to classify:\n"${tweetText}"` },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      u,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 15000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          if (res.statusCode === 200) {
            try {
              const data = JSON.parse(body);
              const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
              if (!rawJsonText) {
                reject(new Error(`Empty JSON response from model ${modelName}`));
                return;
              }
              resolve(JSON.parse(rawJsonText));
            } catch (e) {
              reject(new Error(`Failed to parse response from model ${modelName}: ${body}`));
            }
          } else {
            reject(new Error(`Model ${modelName} returned HTTP ${res.statusCode}: ${body.slice(0, 150)}`));
          }
        });
      }
    );
    req.on("timeout", () => {
      req.destroy();
      reject(new Error(`Gemini API request timed out for model ${modelName}`));
    });
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

async function classifyWithGemini(tweetText: string, apiKey: string): Promise<ClassificationResult> {
  let lastError: Error | null = null;

  for (const modelName of CANDIDATE_MODELS) {
    try {
      const result = await callSingleModel(modelName, tweetText, apiKey);
      console.log(` ✅ Gemini classification succeeded using model [${modelName}]!`);
      return result;
    } catch (err: any) {
      console.warn(` ⚠️ Model [${modelName}] failed or rate-limited: ${err.message}. Trying next fallback model...`);
      lastError = err;
    }
  }

  throw new Error(`All candidate Gemini models failed or rate-limited. Last error: ${lastError?.message}`);
}

function autoRecordCompletedResetHistory(tweet: TweetItem, classification: ClassificationResult) {
  try {
    const dateObj = new Date(tweet.createdAt);
    const dateIso = !isNaN(dateObj.getTime()) ? dateObj.toISOString() : new Date().toISOString();
    const dateSlug = dateIso.split("T")[0];
    const historyId = `local-codex-auto-reset-${dateSlug}-${tweet.id.slice(-4)}`;

    let historyContent = fs.readFileSync(HISTORY_FILE, "utf-8");

    if (historyContent.includes(tweet.url) || historyContent.includes(`id: "${historyId}"`)) {
      console.log(`Reset history for tweet ${tweet.id} already exists in resetHistory.ts. Skipping history append.`);
    } else {
      historyContent = historyContent.replace(
        /export const LOCAL_MODEL_UPDATED_AT = "[^"]+";/,
        `export const LOCAL_MODEL_UPDATED_AT = "${dateIso}";`
      );

      const title = classification.reset_title_ja || "Codex利用上限強制リセット";
      const reasonType = classification.reset_type_ja || "ご祝儀リセット";
      const noticeToExec = classification.notice_to_execution || "0分";

      const newHistoryEvent = {
        id: historyId,
        title: title,
        kind: "reset_completed",
        status: "closed",
        opened_at: dateIso,
        closed_at: dateIso,
        completed_at: dateIso,
        window_minutes: 0,
        scope: "全有料プラン",
        summary: classification.reason_ja,
        source_url: tweet.url,
        details: {
          cycleType: "ランダムリセット",
          reasonType: reasonType,
          resetMethod: "強制リセット",
          scope: "全有料プラン",
          noticeToExecution: noticeToExec,
          note: classification.reason_ja,
        },
      };

      const historyMarker = "export const LOCAL_RESET_HISTORY: Array<WindowEventLike> = [";
      const formattedHistoryString = `  ${JSON.stringify(newHistoryEvent, null, 4).replace(/"([^"]+)":/g, "$1:")},`;

      historyContent = historyContent.replace(
        historyMarker,
        `${historyMarker}\n${formattedHistoryString}`
      );

      fs.writeFileSync(HISTORY_FILE, historyContent, "utf-8");
      console.log(`🎉 Automatically recorded new completed reset event [${historyId}] to data/resetHistory.ts!`);
    }

    let signalsContent = fs.readFileSync(SIGNALS_FILE, "utf-8");
    signalsContent = signalsContent.replace(
      /(status:\s*)"active"/g,
      `$1"resolved",\n    resolvedAt: "${dateIso}"`
    );
    fs.writeFileSync(SIGNALS_FILE, signalsContent, "utf-8");
    console.log(`🧹 Cleared all active signals in observationSignals.ts to resolved state.`);

  } catch (err: any) {
    console.error(`❌ Failed to record completed reset history: ${err.message}`);
  }
}

/**
 * 新機能発表・フェイント投稿時: 匂わせシグナルは解除せず active で維持！
 * ただし重複して超高確率(85%/98%)になっていた場合は、匂わせ基本高確率(35%/50%)へちょっとだけ引き下げてキープする関数
 */
function autoAdjustTeaserOnFeatureRelease(tweet: TweetItem, classification: ClassificationResult) {
  try {
    let fileContent = fs.readFileSync(SIGNALS_FILE, "utf-8");

    if (fileContent.includes('status: "active"')) {
      // 24時間以内のブーストのみを 1/3 カット (0.345 -> 0.230, 24h確率を約30%へ微減)、48hブースト(0.48)は本命用にキープ！
      fileContent = fileContent.replace(/boostValue24h:\s*[\d.]+/g, "boostValue24h: 0.230");
      fileContent = fileContent.replace(/boostValue48h:\s*[\d.]+/g, "boostValue48h: 0.48");

      fs.writeFileSync(SIGNALS_FILE, fileContent, "utf-8");
      console.log(`✨ Automatically reduced 24h teaser boost by 1/3 in observationSignals.ts on feature release (24h ~30%, 48h ~55%).`);
    } else {
      console.log(`No active teaser signals found to adjust on feature release.`);
    }
  } catch (err: any) {
    console.error(`❌ Failed to auto-adjust teaser on feature release: ${err.message}`);
  }
}

function autoApplySignalToObservatory(tweet: TweetItem, classification: ClassificationResult) {
  try {
    let fileContent = fs.readFileSync(SIGNALS_FILE, "utf-8");
    const isTeaser = classification.category === "TEASER_HINT";
    const dateObj = new Date(tweet.createdAt);
    const dateIso = !isNaN(dateObj.getTime()) ? dateObj.toISOString() : new Date().toISOString();
    const dateSlug = dateIso.split("T")[0];
    const signalId = `official-tibo-auto-${isTeaser ? "hint" : "notice"}-${dateSlug}-${tweet.id.slice(-4)}`;

    if (fileContent.includes(`id: "${signalId}"`) || fileContent.includes(tweet.url)) {
      console.log(`Signal for tweet ${tweet.id} already exists in observationSignals.ts. Skipping append.`);
      return;
    }

    fileContent = fileContent.replace(
      /(id:\s*"(?:official-tibo-|boost-)[^"]+",[\s\S]*?status:\s*)"active"/g,
      `$1"resolved",\n    resolvedAt: "${dateIso}"`
    );

    const expiresAtObj = new Date(Date.now() + 48 * 60 * 60 * 1000);
    const expiresAtIso = expiresAtObj.toISOString();

    const titleText = isTeaser
      ? `Tibo氏がXにて投稿（${classification.reason_ja}）`
      : `Tibo氏がリセット/制限緩和を正式発表`;

    const newSignalObject = {
      id: signalId,
      observedAt: dateIso,
      type: isTeaser ? "probability_boost" : "official_notice",
      status: "active",
      expiresAt: expiresAtIso,
      boostValue24h: isTeaser ? 0.345 : undefined,
      boostValue48h: isTeaser ? 0.48 : undefined,
      boostReason: `Tibo氏のX投稿（AI自動判定: ${classification.reason_ja}）`,
      title: titleText,
      source: tweet.url,
      sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより（自動判定）",
    };

    const targetMarker = "export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [";
    const formattedSignalString = `  ${JSON.stringify(newSignalObject, null, 4).replace(/"([^"]+)":/g, "$1:")},`;

    const updatedContent = fileContent.replace(
      targetMarker,
      `${targetMarker}\n${formattedSignalString}`
    );

    fs.writeFileSync(SIGNALS_FILE, updatedContent, "utf-8");
    console.log(`🎉 Automatically added new signal [${signalId}] to observationSignals.ts!`);
  } catch (err: any) {
    console.error(`❌ Failed to auto-apply signal to observationSignals.ts: ${err.message}`);
  }
}

async function main() {
  console.log(`[${new Date().toISOString()}] Starting X Full-Auto Monitoring for @${TARGET_HANDLE}...`);

  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error("❌ Error: GEMINI_API_KEY environment variable is required.");
    process.exit(1);
  }

  const state = readState();
  const html = await fetchSyndicationHtml();
  const tweets = extractTweetsFromHtml(html);

  if (tweets.length === 0) {
    console.log("No tweets found in timeline response.");
    return;
  }

  console.log(`Fetched ${tweets.length} tweets from Twitter Syndication API.`);

  if (!state.lastProcessedTweetId && state.processedTweetIds.length === 0) {
    const newestTweet = tweets[0];
    console.log(`Initial run detected. Setting baseline lastProcessedTweetId to ${newestTweet.id} without processing.`);
    state.lastProcessedTweetId = newestTweet.id;
    state.processedTweetIds = [newestTweet.id];
    saveState(state);
    return;
  }

  const newTweets: TweetItem[] = [];
  for (const tweet of tweets) {
    if (tweet.id === state.lastProcessedTweetId || state.processedTweetIds.includes(tweet.id)) {
      break;
    }
    newTweets.push(tweet);
  }

  newTweets.reverse();

  if (newTweets.length === 0) {
    console.log("No new tweets since last check.");
    return;
  }

  console.log(`Found ${newTweets.length} new tweet(s) to process!`);

  for (const tweet of newTweets) {
    console.log(`Processing Tweet ID: ${tweet.id} (${tweet.createdAt})...`);
    console.log(`Text: "${tweet.text}"`);

    const classification = await classifyWithGemini(tweet.text, apiKey);
    console.log(` -> AI Category: ${classification.category} (Confidence: ${classification.confidence}, Reason: ${classification.reason_ja})`);

    // 異常に低い信頼度(0.60未満)の場合のみ安全ガードとしてスキップ
    if (classification.confidence < SAFETY_MIN_CONFIDENCE) {
      console.warn(` ⚠️ Skipping signal creation due to extremely low AI confidence score (${classification.confidence} < ${SAFETY_MIN_CONFIDENCE}).`);
    } else if (classification.category === "RESET_COMPLETED") {
      console.log(` 🏆 RESET COMPLETED Detected! Automatically updating history & clearing old signals...`);
      autoRecordCompletedResetHistory(tweet, classification);
    } else if (classification.category === "TEASER_RESOLVED_BY_FEATURE") {
      console.log(` 💡 Feature Release Detected! Maintaining active teaser at target boost values (35%/50%)...`);
      autoAdjustTeaserOnFeatureRelease(tweet, classification);
    } else if (classification.category === "OFFICIAL_NOTICE" || classification.category === "TEASER_HINT") {
      console.log(` 🚨 Notice/Hint Signal Detected! Category: ${classification.category}`);
      autoApplySignalToObservatory(tweet, classification);
    } else {
      console.log(` ℹ️ Category is IRRELEVANT. Skipping.`);
    }

    state.lastProcessedTweetId = tweet.id;
    if (!state.processedTweetIds.includes(tweet.id)) {
      state.processedTweetIds.unshift(tweet.id);
      if (state.processedTweetIds.length > 50) {
        state.processedTweetIds.pop();
      }
    }
    saveState(state);
  }

  console.log("Full-Auto Monitoring process completed successfully.");
}

main().catch((err) => {
  console.error("Fatal error in X monitoring script:", err);
  process.exit(1);
});
