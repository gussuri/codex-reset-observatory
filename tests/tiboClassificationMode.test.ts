import assert from "node:assert/strict";
import test from "node:test";

import { classifyTiboTweet } from "../lib/radar/classification";
import {
  selectTiboClassification,
  type TiboClassificationMode,
} from "../lib/radar/tiboClassificationMode";
import type { GeminiClassificationOutput } from "../lib/radar/geminiClassification";

const futureResetText = "We plan to reset all paid users' usage limits at 10:00 UTC on Thursday, October 22.";
const ruleResult = classifyTiboTweet(futureResetText);

function failedGeminiResult(status: "timeout" | "api_error"): GeminiClassificationOutput {
  return {
    signalType: null,
    confidence: null,
    temporalDirection: null,
    evidenceQuote: null,
    reasonJa: null,
    resetTypeJa: null,
    noticeToExecution: null,
    model: null,
    status,
    classifiedAt: null,
  };
}

test("primary and hybrid classification failures select the future notice rule result", () => {
  for (const mode of ["primary", "hybrid"] as const satisfies ReadonlyArray<TiboClassificationMode>) {
    for (const status of ["timeout", "api_error"] as const) {
      const selected = selectTiboClassification(mode, ruleResult, failedGeminiResult(status));

      assert.equal(selected.signalType, "official_notice", `${mode}/${status}`);
      assert.equal(selected.classificationSource, "rule_fallback", `${mode}/${status}`);
    }
  }
});

test("classification off uses the future notice rule without marking it as a fallback", () => {
  const selected = selectTiboClassification("off", ruleResult, null);

  assert.equal(selected.signalType, "official_notice");
  assert.equal(selected.classificationSource, "rule");
});
