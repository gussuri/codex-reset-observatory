import assert from "node:assert/strict";
import test from "node:test";

import { getTiboContextSafetyDecision } from "../lib/radar/tiboContextSafety";
import { getEffectiveTeaserStrength } from "../lib/radar/teaserStrength";

const baseInput = {
  authorText: "me receiving this very important item",
  selectedSignalType: "teaser" as const,
  aiTeaserStrength: "strong" as const,
};

test("item receipt without reset context is suppressed and keeps an auditable reason", () => {
  const decision = getTiboContextSafetyDecision({
    ...baseInput,
    replyContextText: "haven't used it yet, but I'll take a look. Codex for scale.",
  });

  assert.deepEqual(decision, {
    signalType: "irrelevant",
    teaserStrength: "none",
    reasonJa: "Context safety guard: 物品の受領を示す投稿ですが、本文・返信元・引用文脈に利用枠リセットの明示的な根拠がないため、無関係として扱います。",
  });
});

test("a direct reset-button acquisition remains positive", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      ...baseInput,
      authorText: "I was gifted a very fancy new reset button today",
    }),
    null,
  );
});

test("explicit reset context in the parent preserves the positive result", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      ...baseInput,
      replyContextText: "Here is your new reset button",
    }),
    null,
  );
});

test("Codex alone does not count as reset context", () => {
  const decision = getTiboContextSafetyDecision({
    ...baseInput,
    replyContextText: "Codex for scale",
  });

  assert.equal(decision?.signalType, "irrelevant");
  assert.equal(decision?.teaserStrength, "none");
});

test("explicit reset context in a quote preserves the positive result", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      ...baseInput,
      quoteContextText: "This is your new reset button",
    }),
    null,
  );
});

test("an irrelevant result with an AI weak strength is also suppressed", () => {
  const decision = getTiboContextSafetyDecision({
    ...baseInput,
    selectedSignalType: "irrelevant",
    aiTeaserStrength: "weak",
  });

  assert.equal(decision?.signalType, "irrelevant");
  assert.equal(decision?.teaserStrength, "none");
  assert.equal(
    getEffectiveTeaserStrength({
      teaser_strength: decision?.teaserStrength,
      ai_teaser_strength: "strong",
    }),
    "none",
  );
});
