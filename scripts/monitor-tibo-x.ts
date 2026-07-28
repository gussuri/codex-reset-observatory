import fs from "node:fs";
import path from "node:path";
import https from "node:https";

const TARGET_HANDLE = "thsottiaux";
const SYNDICATION_URL = `https://syndication.twitter.com/srv/timeline-profile/screen-name/${TARGET_HANDLE}`;
const PROCESSED_STATE_FILE = path.join(process.cwd(), "data", "processedTweets.json");
const SIGNALS_FILE = path.join(process.cwd(), "data", "observationSignals.ts");

type ClassificationResult = {
  category: "OFFICIAL_NOTICE" | "TEASER_HINT" | "IRRELEVANT";
  confidence: number;
  reason_ja: string;
  key_phrase?: string;
  parsed_notice_time?: string | null;
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
      },
      (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => resolve(data));
      }
    );
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

Classify each tweet into EXACTLY ONE of the following categories:
1. "OFFICIAL_NOTICE": Explicit statement that usage/rate limits ARE ALREADY reset or ARE SCHEDULING a limit reset.
2. "TEASER_HINT": A hint, teaser, or ambiguous statement strongly suggesting a rate limit reset, global usage refresh, or "fun week/recharge" teaser within 24-48 hours.
3. "IRRELEVANT": Regular chatter, general feature updates without limit resets, surveys, outage investigation without resets, or explicit statements denying a reset today.

Respond ONLY with valid JSON in this exact structure:
{
  "category": "OFFICIAL_NOTICE" | "TEASER_HINT" | "IRRELEVANT",
  "confidence": number,
  "reason_ja": "判別理由（日本語で分かりやすく説明）",
  "key_phrase": "判定の決め手となったキーワードまたはフレーズ",
  "parsed_notice_time": "告知された日時または表現 (なしの場合は null)"
}
`;

async function classifyWithGemini(tweetText: string, apiKey: string): Promise<ClassificationResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
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
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const data = JSON.parse(body);
            const rawJsonText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (!rawJsonText) {
              reject(new Error(`API Error: ${body}`));
              return;
            }
            resolve(JSON.parse(rawJsonText));
          } catch (e) {
            reject(new Error(`Failed to parse Gemini response: ${body}`));
          }
        });
      }
    );
    req.on("error", reject);
    req.write(payload);
    req.end();
  });
}

/**
 * 検出されたシグナルを data/observationSignals.ts に完全自動で追加書き込みする関数
 * 【スマート制御強化】
 * 1. 過去の古いアクティブな「匂わせ/ブーストシグナル」は重複加算を防ぐため自動で status: "resolved" に変更
 * 2. 有効期限 (48時間) を設定し、結局リセットが来なかった場合も自然失効させる
 */
function autoApplySignalToObservatory(tweet: TweetItem, classification: ClassificationResult) {
  try {
    let fileContent = fs.readFileSync(SIGNALS_FILE, "utf-8");
    const isTeaser = classification.category === "TEASER_HINT";
    const dateObj = new Date(tweet.createdAt);
    const dateIso = !isNaN(dateObj.getTime()) ? dateObj.toISOString() : new Date().toISOString();
    const dateSlug = dateIso.split("T")[0];
    const signalId = `official-tibo-auto-${isTeaser ? "hint" : "notice"}-${dateSlug}-${tweet.id.slice(-4)}`;

    // すでに同じIDまたは同じURLが存在する場合はスキップ
    if (fileContent.includes(`id: "${signalId}"`) || fileContent.includes(tweet.url)) {
      console.log(`Signal for tweet ${tweet.id} already exists in observationSignals.ts. Skipping append.`);
      return;
    }

    // 古いアクティブな匂わせ・手動ブーストシグナルを自動解決 (status: "resolved") に置換して二重加算を防止
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
      boostValue24h: isTeaser ? 0.195 : undefined,
      boostValue48h: isTeaser ? 0.58 : undefined,
      boostReason: `Tibo氏のX投稿（AI自動判定: ${classification.reason_ja}）`,
      title: titleText,
      source: tweet.url,
      sourceLabel: "Tibo氏（OpenAI Codex開発者）のXポストより（自動判定）",
    };

    // LOCAL_OBSERVATION_SIGNALS 配列の先頭に挿入
    const targetMarker = "export const LOCAL_OBSERVATION_SIGNALS: Array<LocalObservationSignal> = [";
    const formattedSignalString = `  ${JSON.stringify(newSignalObject, null, 4).replace(/"([^"]+)":/g, "$1:")},`;

    const updatedContent = fileContent.replace(
      targetMarker,
      `${targetMarker}\n${formattedSignalString}`
    );

    fs.writeFileSync(SIGNALS_FILE, updatedContent, "utf-8");
    console.log(`🎉 Automatically added new signal [${signalId}] and resolved older active signals in observationSignals.ts!`);
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

  // 初回起動時は最新ツイートのIDをベースラインとして設定
  if (!state.lastProcessedTweetId && state.processedTweetIds.length === 0) {
    const newestTweet = tweets[0];
    console.log(`Initial run detected. Setting baseline lastProcessedTweetId to ${newestTweet.id} without processing.`);
    state.lastProcessedTweetId = newestTweet.id;
    state.processedTweetIds = [newestTweet.id];
    saveState(state);
    return;
  }

  // 新規ツイート（未処理のツイート）を抽出
  const newTweets: TweetItem[] = [];
  for (const tweet of tweets) {
    if (tweet.id === state.lastProcessedTweetId || state.processedTweetIds.includes(tweet.id)) {
      break;
    }
    newTweets.push(tweet);
  }

  newTweets.reverse(); // 古い順にソート

  if (newTweets.length === 0) {
    console.log("No new tweets since last check.");
    return;
  }

  console.log(`Found ${newTweets.length} new tweet(s) to process!`);

  for (const tweet of newTweets) {
    console.log(`Processing Tweet ID: ${tweet.id} (${tweet.createdAt})...`);
    console.log(`Text: "${tweet.text}"`);

    const classification = await classifyWithGemini(tweet.text, apiKey);
    console.log(` -> AI Category: ${classification.category} (${classification.reason_ja})`);

    if (classification.category === "OFFICIAL_NOTICE" || classification.category === "TEASER_HINT") {
      console.log(` 🚨 Signal Detected! Category: ${classification.category}`);

      // 【完全全自動】サイトの観測シグナルデータ (observationSignals.ts) を自動更新
      autoApplySignalToObservatory(tweet, classification);
    } else {
      console.log(` ℹ️ Category is IRRELEVANT. Skipping signal creation.`);
    }

    // 状態を更新
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
