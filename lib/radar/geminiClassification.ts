import https from "node:https";

export type GeminiClassificationInput = {
  text: string;
  tweetCreatedAt?: string;
};

export type GeminiClassificationStatus =
  | "success"
  | "skipped"
  | "timeout"
  | "rate_limited"
  | "invalid_json"
  | "invalid_schema"
  | "invalid_evidence"
  | "api_error"
  | "model_not_configured";

export type GeminiClassificationOutput = {
  signalType: "official_notice" | "reset_executed" | "teaser" | "irrelevant" | null;
  confidence: number | null;
  temporalDirection: "future" | "completed_now" | "historical" | "unclear" | null;
  evidenceQuote: string | null;
  reasonJa: string | null;
  resetTypeJa: "ご祝儀リセット" | "詫びリセット" | "定期リセット" | "ランダムリセット" | null;
  noticeToExecution: string | null;
  model: string | null;
  status: GeminiClassificationStatus;
  classifiedAt: string | null;
};

const SYSTEM_PROMPT = `
You are an AI classifier for the OpenAI Codex Reset Observatory system.
You analyze tweets from Tibo (@thsottiaux), an OpenAI engineer leading the Codex team.

Classify each tweet into EXACTLY ONE of the following 4 categories:
1. "reset_executed": A statement confirming that a usage/rate limit reset HAS ALREADY BEEN COMPLETED or IS NOW EFFECTIVE.
   Examples: "I've reset usage limits", "The usage limits have been reset", "We reset all paid accounts", "Limits are refreshed now".

2. "official_notice": An explicit announcement of an upcoming reset scheduled in the near future.
   Examples: "We will reset limits tonight", "Reset scheduled in two hours", "Full reset coming tomorrow".

3. "teaser": Forward-looking post suggesting a reset within 24-48 hours. Merely containing the words "reset" or "reset button" without a future-oriented indicator does NOT qualify.
   Example: "Should we press the reset button tonight?"

4. "irrelevant": General posts, historical memories, past reset references, negative statements ("No reset tonight"), feature releases, or ambiguous chatter.
   Examples: "I reset everyone yesterday" (historical -> irrelevant), "One day we created the reset button and the rest is history" (historical memory -> irrelevant), "No reset tonight" (negative -> irrelevant).

Respond ONLY with a JSON object strictly matching this schema:
{
  "signalType": "reset_executed" | "official_notice" | "teaser" | "irrelevant",
  "confidence": number (between 0.0 and 1.0),
  "temporalDirection": "future" | "completed_now" | "historical" | "unclear",
  "evidenceQuote": string | null (Exact substring from the tweet text acting as primary evidence, or null),
  "reasonJa": string (Japanese explanation, max 300 characters),
  "resetTypeJa": "ご祝儀リセット" | "詫びリセット" | "定期リセット" | "ランダムリセット" | null,
  "noticeToExecution": string | null (Extracted timeframe expression, or null)
}
`;

/**
 * Classifies a Tibo tweet using Gemini API in Shadow Mode.
 * Does not throw exceptions; returns structured output with status on failure.
 */
export async function classifyWithGemini(
  input: GeminiClassificationInput,
  options: {
    apiKey?: string;
    model?: string;
    mode?: string;
    timeoutMs?: number;
  } = {}
): Promise<GeminiClassificationOutput> {
  const nowIso = new Date().toISOString();

  // 1. Resolve configuration
  const mode = (options.mode || process.env.GEMINI_CLASSIFICATION_MODE || "off").toLowerCase();
  const apiKey = options.apiKey || process.env.GEMINI_API_KEY;
  const model = options.model || process.env.GEMINI_MODEL;
  const timeoutMs = options.timeoutMs || 7000; // 7 seconds timeout

  // Default fallback output
  const fallback = (status: GeminiClassificationStatus): GeminiClassificationOutput => ({
    signalType: null,
    confidence: null,
    temporalDirection: null,
    evidenceQuote: null,
    reasonJa: null,
    resetTypeJa: null,
    noticeToExecution: null,
    model: model || null,
    status,
    classifiedAt: status === "skipped" ? null : nowIso,
  });

  // 2. Check mode & configuration
  if (mode === "off" || !mode) {
    return fallback("skipped");
  }

  if (!apiKey || !model) {
    return fallback("model_not_configured");
  }

  // 3. Prepare Single API Payload (Max 1 call per tweet)
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
  const payload = JSON.stringify({
    contents: [
      {
        role: "user",
        parts: [
          { text: SYSTEM_PROMPT },
          { text: `Tweet to classify:\n"${input.text}"` },
        ],
      },
    ],
    generationConfig: {
      responseMimeType: "application/json",
      temperature: 0.0,
    },
  });

  // 4. Perform HTTP Request with Timeout
  try {
    const rawResponseBody = await new Promise<string>((resolve, reject) => {
      const u = new URL(endpoint);
      const req = https.request(
        u,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
          timeout: timeoutMs,
        },
        (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            if (res.statusCode === 200) {
              resolve(body);
            } else if (res.statusCode === 429) {
              reject(new Error("RATE_LIMITED"));
            } else {
              reject(new Error(`API_ERROR:${res.statusCode}`));
            }
          });
        }
      );

      req.on("timeout", () => {
        req.destroy();
        reject(new Error("TIMEOUT"));
      });

      req.on("error", (err) => reject(err));
      req.write(payload);
      req.end();
    });

    // 5. Parse JSON
    let parsed: any;
    try {
      const apiResult = JSON.parse(rawResponseBody);
      const textContent = apiResult?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!textContent) {
        return fallback("invalid_json");
      }
      parsed = JSON.parse(textContent);
    } catch {
      return fallback("invalid_json");
    }

    // 6. Schema Validation
    const allowedSignalTypes = ["official_notice", "reset_executed", "teaser", "irrelevant"];
    const allowedTemporal = ["future", "completed_now", "historical", "unclear"];

    if (
      !parsed ||
      typeof parsed !== "object" ||
      !allowedSignalTypes.includes(parsed.signalType) ||
      typeof parsed.confidence !== "number" ||
      parsed.confidence < 0 ||
      parsed.confidence > 1 ||
      !allowedTemporal.includes(parsed.temporalDirection)
    ) {
      return fallback("invalid_schema");
    }

    // 7. Evidence Quote Validation (Must be actual substring of original tweet text if not null)
    let validQuote: string | null = null;
    if (parsed.evidenceQuote !== null && parsed.evidenceQuote !== undefined) {
      if (typeof parsed.evidenceQuote !== "string" || parsed.evidenceQuote.length > 300) {
        return fallback("invalid_evidence");
      }
      const normQuote = parsed.evidenceQuote.trim().toLowerCase();
      const normText = input.text.toLowerCase();

      if (normQuote.length > 0 && !normText.includes(normQuote)) {
        return fallback("invalid_evidence");
      }
      validQuote = parsed.evidenceQuote.trim();
    }

    // Sanitize reason text length
    const reasonJa = typeof parsed.reasonJa === "string" ? parsed.reasonJa.slice(0, 500) : null;
    const allowedResetTypes = ["ご祝儀リセット", "詫びリセット", "定期リセット", "ランダムリセット"];
    const resetTypeJa = allowedResetTypes.includes(parsed.resetTypeJa) ? parsed.resetTypeJa : null;

    return {
      signalType: parsed.signalType,
      confidence: parsed.confidence,
      temporalDirection: parsed.temporalDirection,
      evidenceQuote: validQuote,
      reasonJa,
      resetTypeJa,
      noticeToExecution: typeof parsed.noticeToExecution === "string" ? parsed.noticeToExecution.slice(0, 100) : null,
      model,
      status: "success",
      classifiedAt: nowIso,
    };
  } catch (err: any) {
    const msg = err?.message || "";
    if (msg === "TIMEOUT") {
      return fallback("timeout");
    }
    if (msg === "RATE_LIMITED") {
      return fallback("rate_limited");
    }
    return fallback("api_error");
  }
}
