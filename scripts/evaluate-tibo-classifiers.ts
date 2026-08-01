import fs from "node:fs";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { classifyTiboTweet, type ClassificationSignalType } from "../lib/radar/classification";
import {
  classifyWithGemini,
  type GeminiClassificationOutput,
  type GeminiClassificationStatus,
} from "../lib/radar/geminiClassification";

type SignalType = ClassificationSignalType;
type GoldSignalType = SignalType;

type CsvRow = {
  tweetId: string;
  text: string;
  tweetCreatedAt: string;
  detectedAt: string;
  isReply: boolean;
  isQuote: boolean;
};

type GoldRow = CsvRow & {
  gold: GoldSignalType;
  ambiguous: boolean;
};

type EvaluationRow = GoldRow & {
  rulePrediction: SignalType;
  ruleConfidence: number;
  ruleReason: string;
  geminiPrediction: SignalType | null;
  geminiConfidence: number | null;
  geminiTemporalDirection: GeminiClassificationOutput["temporalDirection"];
  geminiEvidenceQuote: string | null;
  geminiReasonJa: string | null;
  geminiResetTypeJa: GeminiClassificationOutput["resetTypeJa"];
  geminiNoticeToExecution: string | null;
  geminiStatus: GeminiClassificationStatus;
  geminiLatencyMs: number;
  geminiAttemptCount: number;
  geminiModel: string | null;
  fallbackPrediction: SignalType;
};

type ClassMetrics = {
  support: number;
  precision: number;
  recall: number;
  f1: number;
};

type EvaluationMetrics = {
  total: number;
  validPredictions: number;
  invalidPredictions: number;
  correct: number;
  accuracy: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  byClass: Record<SignalType, ClassMetrics>;
  confusion: Record<GoldSignalType, Record<SignalType | "no_valid_prediction", number>>;
};

type BinaryMetrics = {
  total: number;
  validPredictions: number;
  invalidPredictions: number;
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
  falsePositive: number;
  falseNegative: number;
};

const SIGNAL_TYPES: SignalType[] = ["reset_executed", "official_notice", "teaser", "irrelevant"];
const RESET_RELATED = new Set<SignalType>(["reset_executed", "official_notice", "teaser"]);
const RESET_EXECUTED_ID = new Set([
  "2083395449814229287",
  "2082317452755751098",
  "2081940052154933696",
]);
const TEASER_ID = "2081899343091843463";
const AMBIGUOUS_ID = "2083053369351090254";

function parseArgs(argv: string[]) {
  const args = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const [key, inlineValue] = token.slice(2).split("=", 2);
    if (inlineValue !== undefined) {
      args.set(key, inlineValue);
    } else if (argv[index + 1] && !argv[index + 1].startsWith("--")) {
      args.set(key, argv[index + 1]);
      index += 1;
    } else {
      args.set(key, "true");
    }
  }
  return args;
}

function parseCsv(input: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const character = input[index];
    const next = input[index + 1];

    if (inQuotes) {
      if (character === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        inQuotes = false;
      } else {
        field += character;
      }
    } else if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    if (row.some((value) => value.length > 0)) rows.push(row);
  }
  return rows;
}

function csvRecords(input: string): Record<string, string>[] {
  const rows = parseCsv(input);
  const header = rows.shift() ?? [];
  return rows.map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""]))
  );
}

function required(record: Record<string, string>, key: string): string {
  const value = record[key];
  if (!value) throw new Error(`CSV column ${key} is missing or empty`);
  return value;
}

function parseBoolean(value: string): boolean {
  return value.trim().toLowerCase() === "true";
}

function goldForTweet(tweetId: string): { gold: GoldSignalType; ambiguous: boolean } {
  if (RESET_EXECUTED_ID.has(tweetId)) return { gold: "reset_executed", ambiguous: false };
  if (tweetId === TEASER_ID) return { gold: "teaser", ambiguous: false };
  if (tweetId === AMBIGUOUS_ID) return { gold: "irrelevant", ambiguous: true };
  return { gold: "irrelevant", ambiguous: false };
}

function readInput(filePath: string): GoldRow[] {
  const records = csvRecords(fs.readFileSync(filePath, "utf8"));
  const rows = records.map((record) => {
    const tweetId = required(record, "tweet_id");
    const { gold, ambiguous } = goldForTweet(tweetId);
    return {
      tweetId,
      text: required(record, "text"),
      tweetCreatedAt: required(record, "tweet_created_at"),
      detectedAt: required(record, "detected_at"),
      isReply: parseBoolean(record.is_reply ?? "false"),
      isQuote: parseBoolean(record.is_quote ?? "false"),
      gold,
      ambiguous,
    };
  });

  const ids = new Set(rows.map((row) => row.tweetId));
  if (rows.length !== 23 || ids.size !== 23) {
    throw new Error(`Expected 23 unique rows, found ${rows.length} rows and ${ids.size} unique tweet_id values`);
  }
  return rows;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function isRetryable(status: GeminiClassificationStatus): boolean {
  // The current production classifier exposes 429 as rate_limited and groups
  // HTTP 5xx with api_error. It does not expose the raw status code.
  return status === "rate_limited" || status === "api_error";
}

async function classifyGemini(
  row: GoldRow,
  apiKey: string | undefined,
  model: string | undefined,
  delayMs: number,
): Promise<{
  output: GeminiClassificationOutput;
  latencyMs: number;
  attemptCount: number;
}> {
  const started = performance.now();
  const configured = Boolean(apiKey && model);
  let attemptCount = 0;
  let output: GeminiClassificationOutput;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (configured && attempt > 0) {
      await sleep(delayMs * 2 ** (attempt - 1));
    }
    attemptCount += 1;
    output = await classifyWithGemini(
      {
        text: row.text,
        tweetCreatedAt: row.tweetCreatedAt,
      },
      {
        apiKey,
        model,
        mode: "shadow",
      }
    );
    if (!configured || output.status === "success" || !isRetryable(output.status) || attempt === 2) {
      return {
        output,
        latencyMs: Math.round(performance.now() - started),
        attemptCount,
      };
    }
  }

  throw new Error("Gemini classification loop ended without a result");
}

function makeMetrics(rows: EvaluationRow[], prediction: (row: EvaluationRow) => SignalType | null): EvaluationMetrics {
  const confusion = Object.fromEntries(
    SIGNAL_TYPES.map((gold) => [
      gold,
      Object.fromEntries([...SIGNAL_TYPES, "no_valid_prediction"].map((value) => [value, 0])),
    ])
  ) as EvaluationMetrics["confusion"];
  const byClass = {} as EvaluationMetrics["byClass"];
  let validPredictions = 0;
  let invalidPredictions = 0;
  let correct = 0;

  for (const row of rows) {
    const predicted = prediction(row);
    if (predicted === null) {
      invalidPredictions += 1;
      confusion[row.gold].no_valid_prediction += 1;
      continue;
    }
    validPredictions += 1;
    confusion[row.gold][predicted] += 1;
    if (predicted === row.gold) correct += 1;
  }

  for (const signalType of SIGNAL_TYPES) {
    const support = rows.filter((row) => row.gold === signalType).length;
    const tp = confusion[signalType][signalType];
    const fp = SIGNAL_TYPES.filter((gold) => gold !== signalType).reduce(
      (sum, gold) => sum + confusion[gold][signalType],
      0
    );
    const fn = SIGNAL_TYPES.filter((predicted) => predicted !== signalType).reduce(
      (sum, predicted) => sum + confusion[signalType][predicted],
      0
    ) + confusion[signalType].no_valid_prediction;
    const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
    const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
    const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
    byClass[signalType] = { support, precision, recall, f1 };
  }

  const macro = (key: keyof ClassMetrics) =>
    SIGNAL_TYPES.reduce((sum, signalType) => sum + byClass[signalType][key], 0) / SIGNAL_TYPES.length;
  return {
    total: rows.length,
    validPredictions,
    invalidPredictions,
    correct,
    accuracy: rows.length === 0 ? 0 : correct / rows.length,
    macroPrecision: macro("precision"),
    macroRecall: macro("recall"),
    macroF1: macro("f1"),
    byClass,
    confusion,
  };
}

function binaryMetrics(
  rows: EvaluationRow[],
  prediction: (row: EvaluationRow) => SignalType | null,
  positive: (gold: GoldSignalType) => boolean
): BinaryMetrics {
  let tp = 0;
  let fp = 0;
  let fn = 0;
  let correct = 0;
  let validPredictions = 0;
  let invalidPredictions = 0;

  for (const row of rows) {
    const predicted = prediction(row);
    if (predicted === null) {
      invalidPredictions += 1;
      if (positive(row.gold)) fn += 1;
      continue;
    }
    validPredictions += 1;
    const actualPositive = positive(row.gold);
    const predictedPositive = positive(predicted);
    if (actualPositive === predictedPositive) correct += 1;
    if (actualPositive && predictedPositive) tp += 1;
    if (!actualPositive && predictedPositive) fp += 1;
    if (actualPositive && !predictedPositive) fn += 1;
  }

  const precision = tp + fp === 0 ? 0 : tp / (tp + fp);
  const recall = tp + fn === 0 ? 0 : tp / (tp + fn);
  const f1 = precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    total: rows.length,
    validPredictions,
    invalidPredictions,
    accuracy: rows.length === 0 ? 0 : correct / rows.length,
    precision,
    recall,
    f1,
    falsePositive: fp,
    falseNegative: fn,
  };
}

function fixed(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function countBy<T extends string>(values: T[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
}

function appendMetricTable(lines: string[], values: Array<[string, EvaluationMetrics]>) {
  lines.push("| classifier | accuracy | macro precision | macro recall | macro F1 | valid / total |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const [name, metrics] of values) {
    lines.push(
      `| ${name} | ${fixed(metrics.accuracy)} | ${fixed(metrics.macroPrecision)} | ${fixed(metrics.macroRecall)} | ${fixed(metrics.macroF1)} | ${metrics.validPredictions} / ${metrics.total} |`
    );
  }
}

function appendClassMetrics(lines: string[], name: string, metrics: EvaluationMetrics) {
  lines.push(`#### ${name}`);
  lines.push("");
  lines.push("| class | support | precision | recall | F1 |");
  lines.push("|---|---:|---:|---:|---:|");
  for (const signalType of SIGNAL_TYPES) {
    const item = metrics.byClass[signalType];
    lines.push(`| ${signalType} | ${item.support} | ${fixed(item.precision)} | ${fixed(item.recall)} | ${fixed(item.f1)} |`);
  }
}

function appendConfusion(lines: string[], name: string, metrics: EvaluationMetrics) {
  lines.push(`#### ${name}`);
  lines.push("");
  lines.push("| gold \\ predicted | reset_executed | official_notice | teaser | irrelevant | no valid prediction |");
  lines.push("|---|---:|---:|---:|---:|---:|");
  for (const gold of SIGNAL_TYPES) {
    const row = metrics.confusion[gold];
    lines.push(`| ${gold} | ${row.reset_executed} | ${row.official_notice} | ${row.teaser} | ${row.irrelevant} | ${row.no_valid_prediction} |`);
  }
}

function appendBinary(lines: string[], name: string, metrics: BinaryMetrics) {
  lines.push(`| ${name} | ${fixed(metrics.precision)} | ${fixed(metrics.recall)} | ${fixed(metrics.f1)} | ${metrics.falsePositive} | ${metrics.falseNegative} | ${metrics.invalidPredictions} |`);
}

function reasonForRecommendation(
  rows: EvaluationRow[],
  primaryRows: EvaluationRow[],
  ruleMetrics: EvaluationMetrics,
  geminiMetrics: EvaluationMetrics,
  fallbackMetrics: EvaluationMetrics,
  apiSuccess: number
): string {
  if (apiSuccess === 0) {
    return "Gemini APIが有効回答を返していないため、今回の結果だけでは移行判断不能です。キーとモデルを設定して同じスクリプトを再実行し、当面はShadow運用を継続してください。";
  }
  const ruleExecuted = binaryMetrics(primaryRows, (row) => row.rulePrediction, (value) => value === "reset_executed");
  const geminiExecuted = binaryMetrics(primaryRows, (row) => row.geminiPrediction, (value) => value === "reset_executed");
  if (geminiExecuted.recall >= ruleExecuted.recall && geminiMetrics.macroF1 >= ruleMetrics.macroF1 && fallbackMetrics.accuracy >= ruleMetrics.accuracy) {
    return `Gemini主＋ルールfallbackを候補にできます。ただし${rows.length}件（曖昧除外${primaryRows.length}件）の小標本で、official_noticeの正解例もないため、直ちに全面移行せずShadow運用で追加データを集めます。`;
  }
  return "現時点ではルール継続またはGemini Shadow継続を推奨します。reset_executedのRecall、リセット関連Recall、False Positive、API安定性を追加データで確認してから主分類器を決めます。";
}

function csvEscape(value: unknown): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[\",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function writeResults(filePath: string, rows: EvaluationRow[]) {
  const columns = [
    "tweet_id", "text", "gold_signal_type", "is_ambiguous", "rule_prediction", "rule_confidence", "rule_reason", "rule_correct",
    "gemini_prediction", "gemini_confidence", "gemini_temporal_direction", "gemini_evidence_quote", "gemini_reason_ja", "gemini_reset_type_ja",
    "gemini_notice_to_execution", "gemini_status", "gemini_latency_ms", "gemini_attempt_count", "gemini_model", "gemini_correct",
    "fallback_prediction", "fallback_correct",
  ];
  const lines = [columns.join(",")];
  for (const row of rows) {
    const values = [
      row.tweetId, row.text, row.gold, row.ambiguous, row.rulePrediction, row.ruleConfidence, row.ruleReason, row.rulePrediction === row.gold,
      row.geminiPrediction, row.geminiConfidence, row.geminiTemporalDirection, row.geminiEvidenceQuote, row.geminiReasonJa, row.geminiResetTypeJa,
      row.geminiNoticeToExecution, row.geminiStatus, row.geminiLatencyMs, row.geminiAttemptCount, row.geminiModel, row.geminiPrediction === row.gold,
      row.fallbackPrediction, row.fallbackPrediction === row.gold,
    ];
    lines.push(values.map(csvEscape).join(","));
  }
  fs.writeFileSync(filePath, `${lines.join("\n")}\n`, "utf8");
}

function buildReport(
  inputPath: string,
  rows: EvaluationRow[],
  primaryRows: EvaluationRow[],
  model: string | undefined,
  apiSuccess: number,
  firstAttemptSuccess: number,
  totalRequests: number,
  retryCount: number,
  metrics: Record<string, EvaluationMetrics>,
  binary: Record<string, BinaryMetrics>
): string {
  const lines: string[] = [];
  const statuses = countBy(rows.map((row) => row.geminiStatus));
  const goldCounts = countBy(rows.map((row) => row.gold));
  const disagreements = rows.filter((row) => row.geminiStatus === "success" && row.rulePrediction !== row.geminiPrediction);
  const errors = rows.filter((row) => row.rulePrediction !== row.gold || (row.geminiStatus === "success" && row.geminiPrediction !== row.gold));
  const apiFailures = rows.filter((row) => row.geminiStatus !== "success");

  lines.push("# Tibo classifier evaluation");
  lines.push("");
  lines.push(`- Input: \`${inputPath}\``);
  lines.push(`- Unique input rows: ${rows.length}`);
  lines.push(`- Primary rows: ${primaryRows.length} (ambiguous tweet ${AMBIGUOUS_ID} excluded)`);
  lines.push(`- Provisional-all rows: ${rows.length}`);
  lines.push(`- Gemini model: ${model || "未設定"}`);
  lines.push(`- API key: ${process.env.GEMINI_API_KEY ? "configured (value omitted)" : "not configured"}`);
  lines.push(`- API success: ${apiSuccess} / ${rows.length}`);
  lines.push(`- First-attempt success: ${firstAttemptSuccess} / ${rows.length}`);
  lines.push(`- Total requests: ${totalRequests}`);
  lines.push(`- Retry requests: ${retryCount}`);
  lines.push(`- Statuses: ${Object.entries(statuses).map(([key, value]) => `${key}=${value}`).join(", ")}`);
  lines.push("");
  lines.push("## Gold labels");
  lines.push("");
  lines.push(Object.entries(goldCounts).map(([key, value]) => `- ${key}: ${value}`).join("\n"));
  lines.push("");
  lines.push("`official_notice` has zero gold examples, so its class-level metrics are undefined in a statistical sense and are shown as 0 for the fixed four-class macro average. Macro metrics average all four fixed classes, including that zero-support class.");
  lines.push("");
  lines.push("## Primary 22-row comparison");
  lines.push("");
  appendMetricTable(lines, [
    ["rule", metrics.primaryRule],
    ["Gemini", metrics.primaryGemini],
    ["Gemini + rule fallback", metrics.primaryFallback],
  ]);
  lines.push("");
  lines.push("### Binary metrics");
  lines.push("");
  lines.push("| classifier | precision | recall | F1 | false positive | false negative | invalid |");
  lines.push("|---|---:|---:|---:|---:|---:|---:|");
  appendBinary(lines, "rule / reset-related", binary.primaryRuleRelated);
  appendBinary(lines, "Gemini / reset-related", binary.primaryGeminiRelated);
  appendBinary(lines, "fallback / reset-related", binary.primaryFallbackRelated);
  appendBinary(lines, "rule / reset-executed", binary.primaryRuleExecuted);
  appendBinary(lines, "Gemini / reset-executed", binary.primaryGeminiExecuted);
  appendBinary(lines, "fallback / reset-executed", binary.primaryFallbackExecuted);
  lines.push("");
  appendClassMetrics(lines, "Rule", metrics.primaryRule);
  lines.push("");
  appendClassMetrics(lines, "Gemini", metrics.primaryGemini);
  lines.push("");
  appendClassMetrics(lines, "Gemini + rule fallback", metrics.primaryFallback);
  lines.push("");
  appendConfusion(lines, "Rule confusion matrix", metrics.primaryRule);
  lines.push("");
  appendConfusion(lines, "Gemini confusion matrix", metrics.primaryGemini);
  lines.push("");
  appendConfusion(lines, "Fallback confusion matrix", metrics.primaryFallback);
  lines.push("");
  lines.push("## Provisional-all 23-row comparison");
  lines.push("");
  appendMetricTable(lines, [
    ["rule", metrics.allRule],
    ["Gemini", metrics.allGemini],
    ["Gemini + rule fallback", metrics.allFallback],
  ]);
  lines.push("");
  appendConfusion(lines, "Rule confusion matrix", metrics.allRule);
  lines.push("");
  appendConfusion(lines, "Gemini confusion matrix", metrics.allGemini);
  lines.push("");
  appendConfusion(lines, "Fallback confusion matrix", metrics.allFallback);
  lines.push("");
  lines.push("## API operations");
  lines.push("");
  const successful = rows.filter((row) => row.geminiStatus === "success");
  const latencies = successful.map((row) => row.geminiLatencyMs).sort((a, b) => a - b);
  const percentile = (fraction: number) => latencies.length === 0 ? null : latencies[Math.min(latencies.length - 1, Math.floor((latencies.length - 1) * fraction))];
  lines.push(`- Valid response rate: ${fixed(apiSuccess / rows.length)}`);
  lines.push(`- Average latency: ${successful.length ? `${Math.round(successful.reduce((sum, row) => sum + row.geminiLatencyMs, 0) / successful.length)} ms` : "n/a"}`);
  lines.push(`- p50 latency: ${percentile(0.5) === null ? "n/a" : `${percentile(0.5)} ms`}`);
  lines.push(`- p95 latency: ${percentile(0.95) === null ? "n/a" : `${percentile(0.95)} ms`}`);
  lines.push("- Token usage: unavailable because the current production Gemini classifier does not expose usageMetadata.");
  lines.push("");
  lines.push("## Mistakes and disagreements");
  lines.push("");
  lines.push("### All classifier mistakes");
  if (errors.length === 0) lines.push("- None");
  for (const row of errors) {
    lines.push(`- ${row.tweetId}: gold=${row.gold}, rule=${row.rulePrediction}, gemini=${row.geminiPrediction ?? `(${row.geminiStatus})`}, fallback=${row.fallbackPrediction}`);
  }
  lines.push("");
  lines.push("### Rule/Gemini disagreements");
  if (disagreements.length === 0) lines.push("- None");
  for (const row of disagreements) {
    lines.push(`- ${row.tweetId}: rule=${row.rulePrediction}, Gemini=${row.geminiPrediction}, evidence=${row.geminiEvidenceQuote ? `\`${row.geminiEvidenceQuote}\`` : "none"}`);
  }
  lines.push("");
  lines.push("### Gemini API failures");
  if (apiFailures.length === 0) lines.push("- None");
  for (const row of apiFailures) lines.push(`- ${row.tweetId}: ${row.geminiStatus}, attempts=${row.geminiAttemptCount}`);
  lines.push("");
  lines.push("## Interpretation and recommendation");
  lines.push("");
  lines.push("- The gold set contains no `official_notice` examples, so notice performance cannot be evaluated.");
  lines.push("- API failures are never converted to `irrelevant`; they remain explicit statuses. For overall accuracy, invalid predictions count as incorrect. The confusion matrix keeps them in a separate `no_valid_prediction` column.");
  lines.push(`- ${reasonForRecommendation(rows, primaryRows, metrics.primaryRule, metrics.primaryGemini, metrics.primaryFallback, apiSuccess)}`);
  lines.push("");
  lines.push("## Scope and safety");
  lines.push("");
  lines.push("This evaluation reads the CSV, calls the existing rule and Gemini classification functions, and writes only the two report files. It does not call the production webhook, write Supabase, update `tibo_signals`, modify classifier prompts/rules, or change `classification_source`.");
  lines.push("");
  lines.push("## Re-run");
  lines.push("");
  lines.push("```text");
  lines.push(`npm run eval:tibo-classifiers -- --input "${inputPath}"`);
  lines.push("```");
  return `${lines.join("\n")}\n`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(args.get("input") || path.join("Downloads", "tibo_signals_rows.csv"));
  const outputDir = path.resolve(args.get("output-dir") || "reports");
  const delayMs = Number(args.get("delay-ms") || 11_000);
  if (!Number.isFinite(delayMs) || delayMs < 0) throw new Error("--delay-ms must be a non-negative number");
  if (!fs.existsSync(inputPath)) throw new Error(`Input CSV not found: ${inputPath}`);

  const inputRows = readInput(inputPath);
  const apiKey = process.env.GEMINI_API_KEY;
  const model = process.env.GEMINI_MODEL;
  const rows: EvaluationRow[] = [];
  let firstAttemptSuccess = 0;
  let totalRequests = 0;

  for (let index = 0; index < inputRows.length; index += 1) {
    const row = inputRows[index];
    if (apiKey && model && index > 0) await sleep(delayMs);
    const ruleResult = classifyTiboTweet(row.text, "");
    const gemini = await classifyGemini(row, apiKey, model, delayMs);
    totalRequests += gemini.attemptCount;
    if (gemini.output.status === "success") {
      if (gemini.attemptCount === 1) firstAttemptSuccess += 1;
    }
    rows.push({
      ...row,
      rulePrediction: ruleResult.signalType,
      ruleConfidence: ruleResult.confidence,
      ruleReason: ruleResult.reason,
      geminiPrediction: gemini.output.signalType,
      geminiConfidence: gemini.output.confidence,
      geminiTemporalDirection: gemini.output.temporalDirection,
      geminiEvidenceQuote: gemini.output.evidenceQuote,
      geminiReasonJa: gemini.output.reasonJa,
      geminiResetTypeJa: gemini.output.resetTypeJa,
      geminiNoticeToExecution: gemini.output.noticeToExecution,
      geminiStatus: gemini.output.status,
      geminiLatencyMs: gemini.latencyMs,
      geminiAttemptCount: gemini.attemptCount,
      geminiModel: gemini.output.model,
      fallbackPrediction: gemini.output.status === "success" && gemini.output.signalType ? gemini.output.signalType : ruleResult.signalType,
    });
    console.log(`${index + 1}/${inputRows.length}: ${row.tweetId} rule=${ruleResult.signalType} gemini=${gemini.output.signalType ?? gemini.output.status}`);
  }

  const primaryRows = rows.filter((row) => !row.ambiguous);
  const metrics: Record<string, EvaluationMetrics> = {
    primaryRule: makeMetrics(primaryRows, (row) => row.rulePrediction),
    primaryGemini: makeMetrics(primaryRows, (row) => row.geminiPrediction),
    primaryFallback: makeMetrics(primaryRows, (row) => row.fallbackPrediction),
    allRule: makeMetrics(rows, (row) => row.rulePrediction),
    allGemini: makeMetrics(rows, (row) => row.geminiPrediction),
    allFallback: makeMetrics(rows, (row) => row.fallbackPrediction),
  };
  const binary: Record<string, BinaryMetrics> = {
    primaryRuleRelated: binaryMetrics(primaryRows, (row) => row.rulePrediction, (value) => RESET_RELATED.has(value)),
    primaryGeminiRelated: binaryMetrics(primaryRows, (row) => row.geminiPrediction, (value) => RESET_RELATED.has(value)),
    primaryFallbackRelated: binaryMetrics(primaryRows, (row) => row.fallbackPrediction, (value) => RESET_RELATED.has(value)),
    primaryRuleExecuted: binaryMetrics(primaryRows, (row) => row.rulePrediction, (value) => value === "reset_executed"),
    primaryGeminiExecuted: binaryMetrics(primaryRows, (row) => row.geminiPrediction, (value) => value === "reset_executed"),
    primaryFallbackExecuted: binaryMetrics(primaryRows, (row) => row.fallbackPrediction, (value) => value === "reset_executed"),
  };

  fs.mkdirSync(outputDir, { recursive: true });
  const dateStamp = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tokyo" }).format(new Date()).replaceAll("-", "");
  const csvPath = path.join(outputDir, `tibo-classifier-eval-${dateStamp}.csv`);
  const reportPath = path.join(outputDir, `tibo-classifier-eval-${dateStamp}.md`);
  writeResults(csvPath, rows);
  fs.writeFileSync(
    reportPath,
    buildReport(
      inputPath,
      rows,
      primaryRows,
      model,
      rows.filter((row) => row.geminiStatus === "success").length,
      firstAttemptSuccess,
      totalRequests,
      totalRequests - rows.length,
      metrics,
      binary
    ),
    "utf8"
  );
  console.log(`Wrote ${csvPath}`);
  console.log(`Wrote ${reportPath}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Evaluation failed");
  process.exitCode = 1;
});
