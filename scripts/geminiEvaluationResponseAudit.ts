import https from "node:https";
import type { IncomingMessage } from "node:http";

export type GeminiResponseAuditContext = {
  scenarioId: string;
  attemptNumber: number;
};

export type GeminiRawModelFields = Record<string, unknown>;

export type GeminiEvaluationResponseAuditRecord = {
  schemaVersion: 1;
  scenarioId: string;
  attemptNumber: number;
  observedAt: string;
  httpStatus: 200;
  parseStatus:
    | "parsed"
    | "response_too_large"
    | "provider_json_invalid"
    | "candidate_text_missing"
    | "model_json_invalid"
    | "model_json_not_object";
  fieldPresence: string[];
  invalidFields: string[];
  fields: GeminiRawModelFields | null;
};

export type GeminiResponseAuditRequestModule = Pick<typeof https, "request">;

const MAX_CAPTURED_RESPONSE_BYTES = 64 * 1024;
const SIGNAL_TYPES = new Set(["official_notice", "reset_executed", "teaser", "irrelevant"]);
const TEMPORAL_DIRECTIONS = new Set(["future", "completed_now", "historical", "unclear"]);
const NOTICE_TIMING_STATUSES = new Set(["known", "unknown"]);
const TEASER_STRENGTHS = new Set(["strong", "weak", "none"]);
const RESET_METHODS = new Set(["forced", "regular_scheduled", "banked_distribution", "personal", "unknown"]);
const RESET_SCOPES = new Set(["all_paid_users", "all_users", "affected_users", "single_account", "unknown"]);

const ENUM_FIELDS: Array<[string, Set<string>]> = [
  ["signalType", SIGNAL_TYPES],
  ["temporalDirection", TEMPORAL_DIRECTIONS],
  ["noticeTimingStatus", NOTICE_TIMING_STATUSES],
  ["teaserStrength", TEASER_STRENGTHS],
];

const NUMBER_FIELDS = ["confidence", "teaserStrengthConfidence", "temporalConfidence", "relativeDayOffset", "relativeAmount"];

const STRING_FIELDS: Array<[string, number]> = [
  ["evidenceQuote", 300],
  ["teaserStrengthEvidenceQuote", 300],
  ["temporalExpression", 160],
  ["temporalKind", 80],
  ["temporalPrecision", 80],
  ["weekday", 40],
  ["relativeUnit", 40],
  ["daypart", 40],
  ["rangeKind", 40],
  ["explicitTimezone", 64],
];

const DATE_PART_KEYS = ["year", "month", "day"] as const;
const TIME_PART_KEYS = ["hour", "minute", "second"] as const;

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseJson(value: string): unknown | null {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function safeString(value: unknown, maxLength: number, redactedValues: readonly string[]) {
  return typeof value === "string" && value.length <= maxLength &&
    !redactedValues.some((redacted) => redacted.length >= 8 && value.includes(redacted))
    ? value
    : undefined;
}

function pickNumberObject(value: unknown, allowedKeys: readonly string[], prefix: string, presence: string[], invalid: string[]) {
  if (value === null) return null;
  if (!isObject(value)) {
    invalid.push(prefix);
    return undefined;
  }
  const picked: Record<string, number> = {};
  for (const key of allowedKeys) {
    if (!Object.hasOwn(value, key)) continue;
    presence.push(prefix + "." + key);
    const number = value[key];
    if (typeof number === "number" && Number.isFinite(number)) picked[key] = number;
    else invalid.push(prefix + "." + key);
  }
  return picked;
}

function captureResetMeaning(value: unknown, presence: string[], invalid: string[], redactedValues: readonly string[]) {
  if (value === null) return null;
  if (!isObject(value)) {
    invalid.push("resetMeaning");
    return undefined;
  }
  const resetMeaning: Record<string, unknown> = {};
  const method = value.method;
  if (Object.hasOwn(value, "method")) {
    presence.push("resetMeaning.method");
    if (method === null || (typeof method === "string" && RESET_METHODS.has(method))) resetMeaning.method = method;
    else invalid.push("resetMeaning.method");
  }
  const scope = value.scope;
  if (Object.hasOwn(value, "scope")) {
    presence.push("resetMeaning.scope");
    if (scope === null || (typeof scope === "string" && RESET_SCOPES.has(scope))) resetMeaning.scope = scope;
    else invalid.push("resetMeaning.scope");
  }
  for (const evidenceField of ["methodEvidence", "scopeEvidence"] as const) {
    if (!Object.hasOwn(value, evidenceField)) continue;
    presence.push("resetMeaning." + evidenceField);
    const evidence = value[evidenceField];
    if (evidence === null) {
      resetMeaning[evidenceField] = null;
      continue;
    }
    if (!isObject(evidence)) {
      invalid.push("resetMeaning." + evidenceField);
      continue;
    }
    const quote = safeString(evidence.quote, 300, redactedValues);
    if (Object.hasOwn(evidence, "quote")) {
      presence.push("resetMeaning." + evidenceField + ".quote");
      if (quote !== undefined || evidence.quote === null) {
        resetMeaning[evidenceField] = { quote: evidence.quote === null ? null : quote };
      } else {
        invalid.push("resetMeaning." + evidenceField + ".quote");
      }
    }
  }
  return resetMeaning;
}

function selectAllowlistedModelFields(value: Record<string, unknown>, redactedValues: readonly string[]) {
  const fields: GeminiRawModelFields = {};
  const fieldPresence: string[] = [];
  const invalidFields: string[] = [];

  for (const [key, allowed] of ENUM_FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    fieldPresence.push(key);
    const field = value[key];
    if (field === null || (typeof field === "string" && allowed.has(field))) fields[key] = field;
    else invalidFields.push(key);
  }

  for (const key of NUMBER_FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    fieldPresence.push(key);
    const field = value[key];
    if (field === null || (typeof field === "number" && Number.isFinite(field) &&
      ((key === "confidence" || key === "teaserStrengthConfidence" || key === "temporalConfidence")
        ? field >= 0 && field <= 1
        : true))) {
      fields[key] = field;
    } else {
      invalidFields.push(key);
    }
  }

  for (const [key, maxLength] of STRING_FIELDS) {
    if (!Object.hasOwn(value, key)) continue;
    fieldPresence.push(key);
    const field = value[key];
    const captured = safeString(field, maxLength, redactedValues);
    if (field === null || captured !== undefined) fields[key] = field === null ? null : captured;
    else invalidFields.push(key);
  }

  for (const [key, keys] of [["explicitDateParts", DATE_PART_KEYS], ["explicitTimeParts", TIME_PART_KEYS]] as const) {
    if (!Object.hasOwn(value, key)) continue;
    fieldPresence.push(key);
    const picked = pickNumberObject(value[key], keys, key, fieldPresence, invalidFields);
    if (picked !== undefined) fields[key] = picked;
  }

  if (Object.hasOwn(value, "resetMeaning")) {
    fieldPresence.push("resetMeaning");
    const resetMeaning = captureResetMeaning(value.resetMeaning, fieldPresence, invalidFields, redactedValues);
    if (resetMeaning !== undefined) fields.resetMeaning = resetMeaning;
  }

  return { fields, fieldPresence, invalidFields };
}

function makeAuditRecord(
  context: GeminiResponseAuditContext,
  parseStatus: GeminiEvaluationResponseAuditRecord["parseStatus"],
  fields: GeminiRawModelFields | null = null,
  fieldPresence: string[] = [],
  invalidFields: string[] = [],
): GeminiEvaluationResponseAuditRecord {
  return {
    schemaVersion: 1,
    scenarioId: context.scenarioId,
    attemptNumber: context.attemptNumber,
    observedAt: new Date().toISOString(),
    httpStatus: 200,
    parseStatus,
    fieldPresence,
    invalidFields,
    fields,
  };
}

function createAuditRecord(
  context: GeminiResponseAuditContext,
  responseBody: Buffer,
  redactedValues: readonly string[],
): GeminiEvaluationResponseAuditRecord {
  const providerResponse = parseJson(responseBody.toString("utf8"));
  if (!isObject(providerResponse)) return makeAuditRecord(context, "provider_json_invalid");
  const candidates = providerResponse.candidates;
  const firstCandidate = Array.isArray(candidates) ? candidates[0] : null;
  const content = isObject(firstCandidate) ? firstCandidate.content : null;
  const parts = isObject(content) && Array.isArray(content.parts) ? content.parts : [];
  const firstPart = parts[0];
  if (!isObject(firstPart) || typeof firstPart.text !== "string") {
    return makeAuditRecord(context, "candidate_text_missing");
  }
  const modelValue = parseJson(firstPart.text);
  if (modelValue === null) return makeAuditRecord(context, "model_json_invalid");
  if (!isObject(modelValue)) return makeAuditRecord(context, "model_json_not_object");
  const selected = selectAllowlistedModelFields(modelValue, redactedValues);
  return makeAuditRecord(context, "parsed", selected.fields, selected.fieldPresence, selected.invalidFields);
}

export async function withGeminiEvaluationResponseAudit<T>(
  requestModule: GeminiResponseAuditRequestModule,
  context: GeminiResponseAuditContext,
  onRecord: (record: GeminiEvaluationResponseAuditRecord) => void,
  action: () => Promise<T>,
  redactedValues: readonly string[] = [],
): Promise<{ result: T; recordCount: number; observerFailureCount: number }> {
  const originalRequest = requestModule.request;
  let recordCount = 0;
  let observerFailureCount = 0;
  let actionFinished = false;
  const stopObservers: Array<() => void> = [];
  const auditedRequest = ((...args: unknown[]) => {
    const callbackIndex = args.findIndex((arg) => typeof arg === "function");
    if (callbackIndex < 0) return Reflect.apply(originalRequest, requestModule, args);

    const callback = args[callbackIndex] as (response: IncomingMessage) => void;
    const auditedArgs = [...args];
    auditedArgs[callbackIndex] = (response: IncomingMessage) => {
      if (response.statusCode === 200 && !actionFinished) {
        let chunks: Buffer[] = [];
        let byteCount = 0;
        let responseTooLarge = false;
        let delivered = false;
        let stopped = false;
        const onData = (chunk: Buffer | string) => {
          if (responseTooLarge || stopped) return;
          const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          byteCount += buffer.length;
          if (byteCount > MAX_CAPTURED_RESPONSE_BYTES) {
            responseTooLarge = true;
            chunks = [];
            return;
          }
          chunks.push(buffer);
        };
        const onEnd = () => {
          if (delivered || stopped) return;
          delivered = true;
          const record = responseTooLarge
            ? makeAuditRecord(context, "response_too_large")
            : createAuditRecord(context, Buffer.concat(chunks), redactedValues);
          chunks = [];
          try {
            onRecord(record);
            recordCount += 1;
          } catch {
            observerFailureCount += 1;
          }
        };
        response.on("data", onData);
        response.on("end", onEnd);
        stopObservers.push(() => {
          stopped = true;
          chunks = [];
          response.removeListener("data", onData);
          response.removeListener("end", onEnd);
        });
      }
      callback(response);
    };
    return Reflect.apply(originalRequest, requestModule, auditedArgs);
  }) as typeof https.request;

  requestModule.request = auditedRequest;
  try {
    return { result: await action(), recordCount, observerFailureCount };
  } finally {
    actionFinished = true;
    for (const stop of stopObservers) stop();
    if (requestModule.request === auditedRequest) requestModule.request = originalRequest;
  }
}
