import assert from "node:assert/strict";
import test from "node:test";
import scenariosJson from "./fixtures/tibo-scenarios.json";
import { classifyTiboTweet, getTiboClassificationSafetyDecision } from "../lib/radar/classification";
import { applyTiboClassificationSafetyGuard, TIBO_GEMINI_SYSTEM_PROMPT, type GeminiClassificationOutput } from "../lib/radar/geminiClassification";
import { getTiboContextSafetyDecision } from "../lib/radar/tiboContextSafety";
import { selectTiboClassification } from "../lib/radar/tiboClassificationMode";
import { runTiboScenario, type TiboScenarioFixture } from "./tiboScenarioSupport";

const targetText = "That was yesterday, today is DevDay. And it's all good news. I'm surprised we've kept it all under wraps.";
const targetUrl = "https://x.com/thsottiaux/status/2104838506363408740";
const concealedCases = (scenariosJson as TiboScenarioFixture).scenarios.filter(
  (scenario) => scenario.regressionGroup === "concealed-imminent-release-teaser",
);

test("Gemini prompt allows only a combined near-term product reveal teaser without explicit reset wording", () => {
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /not require an explicit usage-reset word/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /near-term OpenAI\/Codex event, product, subscription, or usage announcement/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /deliberately concealed/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /combined evidence/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /ordinary feature or release announcements? alone remain irrelevant/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /good news alone is not enough/i);
  assert.match(TIBO_GEMINI_SYSTEM_PROMPT, /implicit teasers, keep confidence moderate \(0\.80-0\.90\)/i);
});

test("an incidental yesterday reference does not suppress the strong DevDay teaser from Gemini", () => {
  const rule = classifyTiboTweet(targetText, targetUrl, { isReply: false, isQuote: false });
  assert.equal(rule.signalType, "irrelevant", "deterministic fallback must not hard-code release phrases");

  const modelResult: GeminiClassificationOutput = {
    signalType: "teaser",
    confidence: 0.85,
    temporalDirection: "unclear",
    evidenceQuote: "all good news",
    reasonJa: "A near-term OpenAI event and deliberately concealed announcement make a reset plausible as a teaser, not a commitment.",
    resetTypeJa: null,
    noticeToExecution: null,
    teaserStrength: "strong",
    teaserStrengthConfidence: 0.85,
    teaserStrengthEvidenceQuote: "kept it all under wraps",
    teaserStrengthReasonJa: "The imminent event and strong concealment cue combine into an indirect hint.",
    model: "test-model",
    status: "success",
    classifiedAt: "2026-09-29T00:00:00.000Z",
  };

  const safety = getTiboClassificationSafetyDecision(targetText, "teaser");
  assert.equal(safety.signalType, "teaser");
  assert.equal(safety.suppressTeaserStrength, false);
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: targetText,
      selectedSignalType: "teaser",
      aiTeaserStrength: "strong",
    }),
    null,
  );

  const guarded = applyTiboClassificationSafetyGuard(targetText, modelResult);
  assert.equal(guarded.signalType, "teaser");
  assert.equal(guarded.teaserStrength, "strong");
  assert.equal(guarded.confidence, 0.85);

  const selected = selectTiboClassification("primary", rule, guarded);
  assert.equal(selected.signalType, "teaser");
  assert.equal(selected.classificationSource, "gemini");
});

test("indirect announcement and negative controls keep their fixture expectations through the offline pipeline", () => {
  assert.equal(concealedCases.length, 12);

  for (const scenario of concealedCases) {
    const run = runTiboScenario(scenario);
    assert.equal(run.ruleResult.signalType, "irrelevant", `${scenario.id}: rules stay narrow`);
    assert.equal(run.selected.signalType, scenario.expected.signalType, scenario.id);
    assert.equal(run.teaserStatus, scenario.expected.teaserStrength ?? "none", scenario.id);
    assert.equal(run.publicSnapshot.viewModel.activeWindow.active, false, scenario.id);
    assert.equal(run.formalAccepted, false, `${scenario.id}: teaser/irrelevant is not reset history`);
  }
});

test("explicit reset negation and technical database reset still suppress a model teaser", () => {
  const controls = [
    {
      text: "No reset tomorrow, but DevDay will be fun.",
      url: "https://x.com/thsottiaux/status/910000000000001108",
    },
    {
      text: "Reset the test database before tomorrow's launch.",
      url: "https://x.com/thsottiaux/status/910000000000001109",
    },
  ];

  for (const control of controls) {
    const candidate: GeminiClassificationOutput = {
      signalType: "teaser",
      confidence: 0.85,
      temporalDirection: "future",
      evidenceQuote: control.text,
      reasonJa: "simulated model candidate",
      resetTypeJa: null,
      noticeToExecution: null,
      teaserStrength: "strong",
      teaserStrengthConfidence: 0.85,
      teaserStrengthEvidenceQuote: control.text,
      teaserStrengthReasonJa: "simulated model candidate",
      model: "test-model",
      status: "success",
      classifiedAt: "2026-09-29T00:00:00.000Z",
    };

    const guarded = applyTiboClassificationSafetyGuard(control.text, candidate);
    assert.equal(guarded.signalType, "irrelevant", control.text);
    assert.equal(guarded.teaserStrength, "none", control.text);
  }
});
