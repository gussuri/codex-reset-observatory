import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import {
  classifyWithGemini,
  type GeminiClassificationOutput,
  type GeminiClassificationStatus,
} from "../lib/radar/geminiClassification";
import {
  parseTiboTemporalSemantics,
  resolveTiboTemporalSchedule,
  TIBO_SOURCE_TIME_ZONE,
  type TemporalResolutionStatus,
} from "../lib/radar/tiboTemporal";
import {
  buildGeminiScenarioInput,
  type TiboScenario,
  type TiboScenarioFixture,
} from "../tests/tiboScenarioSupport";
import fixtureJson from "../tests/fixtures/tibo-scenarios.json";

const SIGNAL_TYPES = ["reset_executed", "official_notice", "teaser", "irrelevant"] as const;
type SignalType = (typeof SIGNAL_TYPES)[number];
const RESET_RELATED = new Set<SignalType>(["reset_executed", "official_notice", "teaser"]);
const MAX_TRANSIENT_ATTEMPTS = 2;
const TRANSIENT_STATUSES = new Set<GeminiClassificationStatus>(["timeout", "api_error"]);

export type ScenarioEvaluationRow = {
  id: string;
  category: string;
  ambiguous: boolean;
  expectedSignalType: SignalType;
  expectedTemporalDirection?: TiboScenario["expected"]["temporalDirection"];
  expectedTeaserStrength?: TiboScenario["expected"]["teaserStrength"];
  expectedTemporalResolutionStatus?: TemporalResolutionStatus;
  expectedTemporalPrecision?: TiboScenario["expected"]["temporalPrecision"];
  predictedSignalType: SignalType | null;
  confidence: number | null;
  temporalDirection: GeminiClassificationOutput["temporalDirection"];
  teaserStrength: GeminiClassificationOutput["teaserStrength"];
  temporalResolutionStatus: TemporalResolutionStatus;
  temporalPrecision: GeminiClassificationOutput["temporalPrecision"] | null;
  reasonJa: string | null;
  evidenceQuote: string | null;
  status: GeminiClassificationStatus;
  attempts: number;
  latencyMs: number;
  text: string;
};

export type ScenarioMetrics = {
  total: number;
  evaluated: number;
  validPredictions: number;
  invalidPredictions: number;
  ambiguousExcluded: number;
  correct: number;
  accuracy: number | null;
  macroF1: number | null;
  byClass: Record<SignalType, { support: number; precision: number; recall: number; f1: number }>;
  confusion: Record<SignalType, Record<SignalType | "no_valid_prediction", number>>;
  binaryResetRelated: { support: number; precision: number; recall: number; f1: number };
  temporalDirectionAccuracy: number | null;
  teaserStrengthAccuracy: number | null;
  temporalResolutionAccuracy: number | null;
  temporalPrecisionAccuracy: number | null;
  falsePositives: Array<{ id: string; category: string; text: string; predicted: SignalType | null }>;
  falseNegatives: Array<{ id: string; category: string; text: string; predicted: SignalType | null }>;
  byCategory: Record<string, { total: number; evaluated: number; correct: number; accuracy: number | null }>;
};

type Checkpoint = {
  schemaVersion: 1;
  model: string;
  fixtureScenarioCount: number;
  rows: ScenarioEvaluationRow[];
  stoppedAfterRateLimit: boolean;
  updatedAt: string;
};

function loadLocalEnvironment() {
  const envPath = path.join(process.cwd(), ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match || process.env[match[1]]) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    process.env[match[1]] = value;
  }
}

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

function isMainModule() {
  return Boolean(process.argv[1]) && path.resolve(fileURLToPath(import.meta.url)) === path.resolve(process.argv[1]);
}

function sleep(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

function f1(precision: number, recall: number) {
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function calculateClassMetrics(rows: ScenarioEvaluationRow[], signalType: SignalType): { support: number; precision: number; recall: number; f1: number } {
  const valid = rows.filter((row) => !row.ambiguous && row.status === "success" && row.predictedSignalType);
  const support = valid.filter((row) => row.expectedSignalType === signalType).length;
  const predicted = valid.filter((row) => row.predictedSignalType === signalType).length;
  const truePositive = valid.filter(
    (row) => row.expectedSignalType === signalType && row.predictedSignalType === signalType,
  ).length;
  const precision = predicted === 0 ? 0 : truePositive / predicted;
  const recall = support === 0 ? 0 : truePositive / support;
  return { support, precision, recall, f1: f1(precision, recall) };
}

function calculateBinaryMetrics(rows: ScenarioEvaluationRow[]) {
  const valid = rows.filter((row) => !row.ambiguous && row.status === "success" && row.predictedSignalType);
  const actualPositive = valid.filter((row) => RESET_RELATED.has(row.expectedSignalType)).length;
  const predictedPositive = valid.filter((row) => RESET_RELATED.has(row.predictedSignalType as SignalType)).length;
  const truePositive = valid.filter(
    (row) => RESET_RELATED.has(row.expectedSignalType) && RESET_RELATED.has(row.predictedSignalType as SignalType),
  ).length;
  const precision = predictedPositive === 0 ? 0 : truePositive / predictedPositive;
  const recall = actualPositive === 0 ? 0 : truePositive / actualPositive;
  return { support: actualPositive, precision, recall, f1: f1(precision, recall) };
}

export function calculateScenarioMetrics(rows: ScenarioEvaluationRow[]): ScenarioMetrics {
  const valid = rows.filter((row) => !row.ambiguous && row.status === "success" && row.predictedSignalType);
  const evaluated = rows.filter((row) => !row.ambiguous);
  const byClass = Object.fromEntries(
    SIGNAL_TYPES.map((signalType) => [signalType, calculateClassMetrics(rows, signalType)]),
  ) as Record<SignalType, { support: number; precision: number; recall: number; f1: number }>;
  const classF1 = SIGNAL_TYPES.map((signalType) => byClass[signalType].f1);
  const confusion = Object.fromEntries(
    SIGNAL_TYPES.map((expected) => [
      expected,
      Object.fromEntries([
        ...SIGNAL_TYPES.map((predicted) => [predicted, 0]),
        ["no_valid_prediction", 0],
      ]) as Record<SignalType | "no_valid_prediction", number>,
    ]),
  ) as Record<SignalType, Record<SignalType | "no_valid_prediction", number>>;

  for (const row of evaluated) {
    const prediction = row.status === "success" && row.predictedSignalType
      ? row.predictedSignalType
      : "no_valid_prediction";
    confusion[row.expectedSignalType][prediction] += 1;
  }

  const correct = valid.filter((row) => row.expectedSignalType === row.predictedSignalType).length;
  const temporalRows = valid.filter((row) => row.expectedTemporalDirection);
  const teaserRows = valid.filter((row) => row.expectedTeaserStrength);
  const resolutionRows = valid.filter((row) => row.expectedTemporalResolutionStatus);
  const precisionRows = valid.filter((row) => row.expectedTemporalPrecision);
  const accuracy = (count: number, total: number) => total === 0 ? null : count / total;
  const byCategory: ScenarioMetrics["byCategory"] = {};

  for (const row of rows) {
    const item = byCategory[row.category] ?? { total: 0, evaluated: 0, correct: 0, accuracy: null };
    item.total += 1;
    if (!row.ambiguous) {
      item.evaluated += 1;
      if (row.status === "success" && row.predictedSignalType === row.expectedSignalType) item.correct += 1;
    }
    item.accuracy = accuracy(item.correct, item.evaluated);
    byCategory[row.category] = item;
  }

  return {
    total: rows.length,
    evaluated: evaluated.length,
    validPredictions: valid.length,
    invalidPredictions: evaluated.length - valid.length,
    ambiguousExcluded: rows.length - evaluated.length,
    correct,
    accuracy: accuracy(correct, evaluated.length),
    macroF1: classF1.reduce((sum, value) => sum + value, 0) / classF1.length,
    byClass,
    confusion,
    binaryResetRelated: calculateBinaryMetrics(rows),
    temporalDirectionAccuracy: accuracy(
      temporalRows.filter((row) => row.temporalDirection === row.expectedTemporalDirection).length,
      temporalRows.length,
    ),
    teaserStrengthAccuracy: accuracy(
      teaserRows.filter((row) => row.teaserStrength === row.expectedTeaserStrength).length,
      teaserRows.length,
    ),
    temporalResolutionAccuracy: accuracy(
      resolutionRows.filter((row) => row.temporalResolutionStatus === row.expectedTemporalResolutionStatus).length,
      resolutionRows.length,
    ),
    temporalPrecisionAccuracy: accuracy(
      precisionRows.filter((row) => row.temporalPrecision === row.expectedTemporalPrecision).length,
      precisionRows.length,
    ),
    falsePositives: rows
      .filter((row) => !row.ambiguous && row.expectedSignalType === "irrelevant" && RESET_RELATED.has(row.predictedSignalType as SignalType))
      .map((row) => ({ id: row.id, category: row.category, text: row.text, predicted: row.predictedSignalType })),
    falseNegatives: rows
      .filter((row) => !row.ambiguous && RESET_RELATED.has(row.expectedSignalType) && row.predictedSignalType === "irrelevant")
      .map((row) => ({ id: row.id, category: row.category, text: row.text, predicted: row.predictedSignalType })),
    byCategory,
  };
}

function resolutionFor(scenario: TiboScenario, prediction: GeminiClassificationOutput) {
  const semantics = parseTiboTemporalSemantics(prediction, scenario.tweetText);
  return resolveTiboTemporalSchedule(semantics, scenario.tweetCreatedAt, TIBO_SOURCE_TIME_ZONE);
}

async function evaluateScenario(scenario: TiboScenario, model: string, apiKey: string): Promise<ScenarioEvaluationRow> {
  let attempts = 0;
  let last: GeminiClassificationOutput | null = null;
  const started = performance.now();

  while (attempts < MAX_TRANSIENT_ATTEMPTS) {
    attempts += 1;
    last = await classifyWithGemini(buildGeminiScenarioInput(scenario), {
      apiKey,
      model,
      mode: "primary",
      timeoutMs: 7000,
    });
    if (!TRANSIENT_STATUSES.has(last.status) || attempts >= MAX_TRANSIENT_ATTEMPTS) break;
    await sleep(1500);
  }

  const prediction = last ?? {
    signalType: null,
    confidence: null,
    temporalDirection: null,
    evidenceQuote: null,
    reasonJa: null,
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: null,
    teaserStrengthConfidence: null,
    teaserStrengthEvidenceQuote: null,
    teaserStrengthReasonJa: null,
    temporalExpression: null,
    temporalKind: null,
    temporalPrecision: null,
    weekday: null,
    relativeDayOffset: null,
    relativeAmount: null,
    relativeUnit: null,
    explicitDateParts: null,
    explicitTimeParts: null,
    daypart: null,
    rangeKind: null,
    explicitTimezone: null,
    temporalConfidence: null,
    model,
    status: "api_error" as const,
    classifiedAt: null,
  };
  const resolution = resolutionFor(scenario, prediction);

  return {
    id: scenario.id,
    category: scenario.category,
    ambiguous: scenario.ambiguous === true,
    expectedSignalType: scenario.expected.signalType ?? "irrelevant",
    expectedTemporalDirection: scenario.expected.temporalDirection,
    expectedTeaserStrength: scenario.expected.teaserStrength,
    expectedTemporalResolutionStatus: scenario.expected.temporalResolutionStatus,
    expectedTemporalPrecision: scenario.expected.temporalPrecision,
    predictedSignalType: prediction.signalType,
    confidence: prediction.confidence,
    temporalDirection: prediction.temporalDirection,
    teaserStrength: prediction.teaserStrength ?? null,
    temporalResolutionStatus: resolution.status,
    temporalPrecision: resolution.status === "resolved" ? resolution.temporalPrecision : prediction.temporalPrecision,
    reasonJa: prediction.reasonJa,
    evidenceQuote: prediction.evidenceQuote,
    status: prediction.status,
    attempts,
    latencyMs: Math.round(performance.now() - started),
    text: scenario.tweetText,
  };
}

function checkpointPath(outputDir: string) {
  return path.join(outputDir, "checkpoint.json");
}

function writeCheckpoint(outputDir: string, checkpoint: Checkpoint) {
  fs.writeFileSync(checkpointPath(outputDir), `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
}

function readCheckpoint(outputDir: string): Checkpoint | null {
  const filePath = checkpointPath(outputDir);
  if (!fs.existsSync(filePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Checkpoint;
    if (parsed.schemaVersion !== 1 || !Array.isArray(parsed.rows)) return null;
    return parsed;
  } catch {
    return null;
  }
}

function percent(value: number | null) {
  return value === null ? "n/a" : `${(value * 100).toFixed(1)}%`;
}

function renderReport(model: string, rows: ScenarioEvaluationRow[], metrics: ScenarioMetrics, complete: boolean, stoppedAfterRateLimit: boolean) {
  const status = complete ? "complete" : "incomplete";
  const lines = [
    "# Tibo Scenario Evaluation",
    "",
    `- status: **${status}**`,
    `- model: \`${model}\``,
    `- scenario count: ${rows.length}`,
    `- valid predictions: ${metrics.validPredictions}`,
    `- API failures / invalid predictions: ${metrics.invalidPredictions}`,
    `- rate limited stop: ${stoppedAfterRateLimit ? "yes" : "no"}`,
    "- existing 23-post evaluation: unchanged and separate",
    "- production DB/webhook writes: none",
    "",
    "## Overall",
    "",
    `- accuracy: ${percent(metrics.accuracy)}`,
    `- macro F1: ${percent(metrics.macroF1)}`,
    `- reset-related precision / recall / F1: ${percent(metrics.binaryResetRelated.precision)} / ${percent(metrics.binaryResetRelated.recall)} / ${percent(metrics.binaryResetRelated.f1)}`,
    `- temporal direction accuracy: ${percent(metrics.temporalDirectionAccuracy)}`,
    `- teaser strength accuracy: ${percent(metrics.teaserStrengthAccuracy)}`,
    `- temporal resolution accuracy: ${percent(metrics.temporalResolutionAccuracy)}`,
    `- temporal precision accuracy: ${percent(metrics.temporalPrecisionAccuracy)}`,
    "",
    "## Per class",
    "",
    "| Class | Support | Precision | Recall | F1 |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...SIGNAL_TYPES.map((signalType) => {
      const item = metrics.byClass[signalType];
      return `| ${signalType} | ${item.support} | ${percent(item.precision)} | ${percent(item.recall)} | ${percent(item.f1)} |`;
    }),
    "",
    "## Category",
    "",
    "| Category | Total | Evaluated | Correct | Accuracy |",
    "| --- | ---: | ---: | ---: | ---: |",
    ...Object.entries(metrics.byCategory).sort(([left], [right]) => left.localeCompare(right)).map(([category, item]) =>
      `| ${category} | ${item.total} | ${item.evaluated} | ${item.correct} | ${percent(item.accuracy)} |`,
    ),
    "",
    "## Confusion matrix",
    "",
    "```json",
    JSON.stringify(metrics.confusion, null, 2),
    "```",
    "",
    "## False positives",
    "",
    ...(metrics.falsePositives.length
      ? metrics.falsePositives.map((item) => `- **${item.id}** (${item.category}) → ${item.predicted}: ${item.text}`)
      : ["- none"]),
    "",
    "## False negatives",
    "",
    ...(metrics.falseNegatives.length
      ? metrics.falseNegatives.map((item) => `- **${item.id}** (${item.category}) → irrelevant: ${item.text}`)
      : ["- none"]),
    "",
    "## Case results",
    "",
    "| ID | Category | Expected | Predicted | Status | Temporal | Teaser |",
    "| --- | --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row.id} | ${row.category} | ${row.expectedSignalType} | ${row.predictedSignalType ?? "—"} | ${row.status} | ${row.temporalResolutionStatus} | ${row.teaserStrength ?? "—"} |`),
    "",
    "This is a manual classifier evaluation only. It never writes synthetic data to Production and does not change the existing 23-post historical evaluation.",
    "",
  ];
  return lines.join("\n");
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.has("help") || !args.has("live")) {
    console.log("Usage: corepack pnpm run eval:tibo-scenarios -- --live [--resume] [--limit N] [--output-dir DIR]");
    console.log("Without --live this script performs no API calls.");
    return;
  }

  loadLocalEnvironment();
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  const model = process.env.GEMINI_MODEL?.trim();
  if (!apiKey || !model) {
    console.log("SKIPPED: GEMINI_API_KEY or GEMINI_MODEL is not configured; no API call was made.");
    return;
  }

  const fixture = fixtureJson as TiboScenarioFixture;
  const outputDir = path.resolve(args.get("output-dir") ?? "scratch/tibo-scenario-evaluation");
  fs.mkdirSync(outputDir, { recursive: true });
  const limit = args.has("limit") ? Math.max(1, Number(args.get("limit"))) : fixture.scenarios.length;
  const checkpoint = args.has("resume") ? readCheckpoint(outputDir) : null;
  const rowsById = new Map<string, ScenarioEvaluationRow>(
    (checkpoint?.rows ?? []).map((row) => [row.id, row]),
  );
  let stoppedAfterRateLimit = checkpoint?.stoppedAfterRateLimit ?? false;

  for (const scenario of fixture.scenarios.slice(0, limit)) {
    const previous = rowsById.get(scenario.id);
    if (previous?.status === "success") continue;

    const row = await evaluateScenario(scenario, model, apiKey);
    rowsById.set(scenario.id, row);
    writeCheckpoint(outputDir, {
      schemaVersion: 1,
      model,
      fixtureScenarioCount: fixture.scenarios.length,
      rows: Array.from(rowsById.values()),
      stoppedAfterRateLimit: row.status === "rate_limited" || stoppedAfterRateLimit,
      updatedAt: new Date().toISOString(),
    });
    console.log(`${row.id}: ${row.status}${row.predictedSignalType ? ` → ${row.predictedSignalType}` : ""}`);
    if (row.status === "rate_limited") {
      stoppedAfterRateLimit = true;
      break;
    }
  }

  const rows = fixture.scenarios
    .map((scenario) => rowsById.get(scenario.id))
    .filter((row): row is ScenarioEvaluationRow => Boolean(row));
  const complete = rows.length === fixture.scenarios.length && rows.every((row) => row.status === "success");
  const metrics = calculateScenarioMetrics(rows);
  const report = {
    schemaVersion: 1,
    status: complete ? "complete" : "incomplete",
    complete,
    model,
    fixtureScenarioCount: fixture.scenarios.length,
    evaluatedScenarioCount: rows.length,
    existingHistoricalEvaluation23Unchanged: true,
    productionWrites: false,
    stoppedAfterRateLimit,
    metrics,
    rows,
    resumeCommand: "corepack pnpm run eval:tibo-scenarios -- --live --resume",
  };
  fs.writeFileSync(path.join(outputDir, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(path.join(outputDir, "report.md"), `${renderReport(model, rows, metrics, complete, stoppedAfterRateLimit)}\n`, "utf8");
  console.log(`Wrote ${path.join(outputDir, "report.json")}`);
  console.log(`Status: ${report.status}; valid predictions: ${metrics.validPredictions}/${fixture.scenarios.length}`);
}

if (isMainModule()) {
  main().catch((error) => {
    console.error(`Scenario evaluation failed: ${error instanceof Error ? error.message : "unknown error"}`);
    process.exitCode = 1;
  });
}
