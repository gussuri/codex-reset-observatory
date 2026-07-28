import https from "node:https";

const SYSTEM_PROMPT = `
You are an AI classifier for an automated Codex Reset Observatory system.
You analyze tweets from Tibo (@thsottiaux), an OpenAI engineer leading the Codex team.

Classify each tweet into EXACTLY ONE of the following categories:
1. "RESET_COMPLETED": Statement confirming that a rate limit reset HAS ALREADY BEEN COMPLETED or IS NOW EFFECTIVE.
2. "OFFICIAL_NOTICE": Statement that rate limits ARE SCHEDULED to be reset at a specific future time/window.
3. "TEASER_HINT": A hint, teaser, or ambiguous statement strongly suggesting an upcoming reset, global usage refresh, or "fun week/recharge" teaser within 24-48 hours.
4. "IRRELEVANT": Regular chatter, general feature updates without limit resets, surveys, outage investigation without resets, or explicit statements denying a reset.

Respond ONLY with valid JSON in this exact structure:
{
  "category": "RESET_COMPLETED" | "OFFICIAL_NOTICE" | "TEASER_HINT" | "IRRELEVANT",
  "confidence": number,
  "reason_ja": "判別理由（日本語）"
}
`;

const DEV_TEST_POSTS = [
  { name: "単純な単語 'test'", text: "test" },
  { name: "パイプラインテスト", text: "testing codex pipeline" },
  { name: "無視の指定があるテスト", text: "ignore this tweet, just testing something on stream" },
  { name: "ハローワールド", text: "hello world" },
  { name: "マイクテスト風", text: "check 1 2 3" },
  { name: "制限通知システムのテスト告知", text: "quick test of the rate limit notification system" },
];

async function testModel(tweetText: string, apiKey: string) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent?key=${apiKey}`;
  const payload = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [{ text: SYSTEM_PROMPT }, { text: `Tweet:\n"${tweetText}"` }],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.1,
    },
  });

  return new Promise((resolve, reject) => {
    const req = https.request(
      new URL(url),
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
            const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
            resolve(JSON.parse(raw));
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.write(payload);
    req.end();
  });
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error("GEMINI_API_KEY required");
    return;
  }

  console.log("=== Testing Developer Test/Debug Tweet Patterns ===\n");
  for (const post of DEV_TEST_POSTS) {
    const res: any = await testModel(post.text, apiKey);
    console.log(`📌 [${post.name}]`);
    console.log(`   Text: "${post.text}"`);
    console.log(`   -> Category: ${res.category} | Confidence: ${res.confidence}`);
    console.log(`   -> Reason: ${res.reason_ja}\n`);
  }
}

main();
