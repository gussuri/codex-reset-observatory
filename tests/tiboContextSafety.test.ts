import assert from "node:assert/strict";
import test from "node:test";

import {
  getTiboContextSafetyDecision,
  type TiboContextSafetyInput,
} from "../lib/radar/tiboContextSafety";
import type { TiboEvidenceContext } from "../lib/radar/tiboEvidenceContext";
import { getEffectiveTeaserStrength } from "../lib/radar/teaserStrength";
import { TIBO_APOLOGY_RESET_NOTICE } from "./fixtures/tiboApologyResetNotice";

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

test("reset wording in parent or quote alone is not attributed to Tibo", () => {
  const authorText = "o yes… we’re back in action. sorry about the brief disruption!";
  const resetContext = "we’ll reset usage limits for all paid users across codex and ChatGPT work";

  for (const contextField of ["replyContextText", "quoteContextText"] as const) {
    const decision = getTiboContextSafetyDecision({
      authorText,
      selectedSignalType: "official_notice",
      aiTeaserStrength: "strong",
      [contextField]: resetContext,
    });

    assert.equal(decision?.signalType, "irrelevant", contextField);
    assert.equal(decision?.teaserStrength, "none", contextField);
  }

  assert.match(TIBO_APOLOGY_RESET_NOTICE.text, /we’ll reset usage limits/);
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

test("physical-item showcase language is suppressed without reset context", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "It has not been used yet, but would you look at that. Codex for scale.",
    selectedSignalType: "teaser",
    aiTeaserStrength: "strong",
  });

  assert.equal(decision?.signalType, "irrelevant");
  assert.equal(decision?.teaserStrength, "none");
});

test("physical-item showcase remains positive with explicit reset context", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "It has not been used yet, but would you look at that. Codex for scale.",
      replyContextText: "Here is your new reset button",
      selectedSignalType: "teaser",
      aiTeaserStrength: "strong",
    }),
    null,
  );
});

test("showcase cues do not suppress a direct reset-button acquisition", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "I was gifted a very fancy new reset button today",
      selectedSignalType: "teaser",
      aiTeaserStrength: "strong",
    }),
    null,
  );
});

test("ambiguous future surprise downgrades an official notice to a strong teaser", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "I previously promised a reset for every 1M in additional active users for Codex, until 10M. We blew past that and have been silent since 10M. Little surprise for you tomorrow.",
    selectedSignalType: "official_notice",
    aiTeaserStrength: "strong",
  });

  assert.equal(decision?.signalType, "teaser");
  assert.equal(decision?.teaserStrength, "strong");
});

test("explicit future reset notices remain official", () => {
  for (const authorText of [
    "I'll do another performative reset on Monday",
    "Enjoy a nice reset everyone. Landing in the next hour or so",
  ]) {
    assert.equal(
      getTiboContextSafetyDecision({
        authorText,
        selectedSignalType: "official_notice",
        aiTeaserStrength: "strong",
      }),
      null,
      authorText,
    );
  }
});

test("an upcoming Codex update does not promote an irrelevant none result", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "Tomorrow we will bring back the 5h limit for Plus accounts across ChatGPT Work and Codex.",
      selectedSignalType: "irrelevant",
      aiTeaserStrength: "none",
    }),
    null,
  );
});

test("an update-only post does not create a context-safety decision", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "Tomorrow we will bring back the 5h limit for Plus accounts across ChatGPT Work and Codex.",
      selectedSignalType: "official_notice",
      aiTeaserStrength: "strong",
    }),
    null,
  );
});

test("a future Codex product update does not promote an irrelevant none result", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "Next week we'll be retiring GPT-5.3-Codex-Spark from ChatGPT Work.",
      selectedSignalType: "irrelevant",
      aiTeaserStrength: "none",
    }),
    null,
  );
});

test("a generic documentation update remains outside the teaser signal", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "Documentation update tomorrow.",
    selectedSignalType: "irrelevant",
    aiTeaserStrength: "none",
  });

  assert.equal(decision, null);
});

test("a person-targeted reset is irrelevant even when AI strength is weak", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "I feel Theo is in need of a reset",
    selectedSignalType: "irrelevant",
    aiTeaserStrength: "weak",
  });

  assert.equal(decision?.signalType, "irrelevant");
  assert.equal(decision?.teaserStrength, "none");
});

test("historical reset-button retrospectives are not active teasers", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "One day we created the reset button and the rest is history.",
    selectedSignalType: "teaser",
    aiTeaserStrength: "weak",
  });

  assert.equal(decision?.signalType, "irrelevant");
  assert.equal(decision?.teaserStrength, "none");
});

test("historical reset context with an independent future reset intent remains positive", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "One day we created the reset button. Tomorrow I'll use it to reset the limits.",
      selectedSignalType: "teaser",
      aiTeaserStrength: "strong",
    }),
    null,
  );
});

test("isolated showcase phrases do not trigger the physical-item guard", () => {
  for (const authorText of [
    "It has not been used yet.",
    "Would you look at that.",
    "Codex for scale.",
  ]) {
    assert.equal(
      getTiboContextSafetyDecision({
        authorText,
        selectedSignalType: "teaser",
        aiTeaserStrength: "strong",
      }),
      null,
      authorText,
    );
  }
});


test("future reuse of a historically framed reset button does not promote an irrelevant none result", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "A good thing about having aged is that I feel that it’s been 20 years since I’ve pressed the reset button. Intrigued to see if I can find it tomorrow and dust it up",
      selectedSignalType: "irrelevant",
      aiTeaserStrength: "none",
    }),
    null,
  );
});

test("historical reset-button text plus an unrelated tomorrow does not get rescued", () => {
  assert.equal(
    getTiboContextSafetyDecision({
      authorText: "It has been 20 years since I pressed the reset button. Tomorrow I am going hiking.",
      selectedSignalType: "irrelevant",
      aiTeaserStrength: "none",
    }),
    null,
  );
});

test("historical and obvious non-usage reset-button contexts remain unpromoted", () => {
  for (const authorText of [
    "It has been years since I pressed the reset button. I might find it tomorrow and dust it up.",
    "My laptop reset button is ancient. I might find it tomorrow and dust it up.",
    "It has been years since I pressed the reset button. I cannot find it tomorrow.",
  ]) {
    assert.equal(
      getTiboContextSafetyDecision({
        authorText,
        selectedSignalType: "irrelevant",
        aiTeaserStrength: "none",
      }),
      null,
      authorText,
    );
  }
});

test("an irrelevant none result is never promoted by context safety alone", () => {
  for (const authorText of [
    "Next week we'll be retiring GPT-5.3-Codex-Spark from ChatGPT Work.",
    "Tomorrow we will bring back the 5h limit for Plus accounts across ChatGPT Work and Codex.",
    "It has been 20 years since I pressed the reset button. I might find it tomorrow and dust it up.",
  ]) {
    const decision = getTiboContextSafetyDecision({
      authorText,
      selectedSignalType: "irrelevant",
      aiTeaserStrength: "none",
    });

    assert.equal(decision, null, authorText);
  }
});

test("Tibo self-quotes with explicit reset context do not demote reset_executed completions to irrelevant", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "Done and dusted.",
    quoteAuthorHandle: "@thsottiaux",
    quoteTweetUrl: "https://x.com/thsottiaux/status/2084000000000000100",
    quoteContextText: "we'll reset usage limits for all paid users across codex and ChatGPT work",
    selectedSignalType: "reset_executed",
  });

  assert.equal(decision, null);
});

test("external user quotes with explicit reset context still demote completions to irrelevant", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "Done and dusted.",
    quoteAuthorHandle: "@external_user",
    quoteTweetUrl: "https://x.com/external_user/status/2084000000000000100",
    quoteContextText: "we'll reset usage limits for all paid users across codex and ChatGPT work",
    selectedSignalType: "reset_executed",
  });

  assert.ok(decision);
  assert.equal(decision?.signalType, "irrelevant");
  assert.equal(decision?.teaserStrength, "none");
});

test("Tibo self-quotes with explicit reset context do not demote official_notice announcements to irrelevant", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "Landing in 1 hour for all accounts.",
    quoteAuthorHandle: "@thsottiaux",
    quoteTweetUrl: "https://x.com/thsottiaux/status/2084000000000000100",
    quoteContextText: "we'll reset usage limits for all paid users across codex and ChatGPT work",
    selectedSignalType: "official_notice",
  });

  assert.equal(decision, null);
});

function validatedLandingContext(depth: 1 | 2 = 1, authorHandle = "@thsottiaux"): TiboEvidenceContext {
  const targetId = "2115000000000000101";
  const parentId = "2115000000000000102";
  const grandparentId = "2115000000000000103";
  const targetUrl = `https://x.com/thsottiaux/status/${targetId}`;
  const parentUrl = `https://x.com/${authorHandle.slice(1)}/status/${parentId}`;
  const grandparentUrl = `https://x.com/thsottiaux/status/${grandparentId}`;
  const target = {
    tweetId: targetId,
    tweetUrl: targetUrl,
    authorHandle: "@thsottiaux",
    text: "Landing within the next 2 hours.",
    createdAt: "2026-10-18T08:00:00.000Z",
  };
  const parent = {
    tweetId: parentId,
    tweetUrl: parentUrl,
    authorHandle,
    text: depth === 1 ? "Reset usage limits for all users tomorrow." : "A rollout is on the way.",
    createdAt: "2026-10-18T07:00:00.000Z",
  };
  const grandparent = {
    tweetId: grandparentId,
    tweetUrl: grandparentUrl,
    authorHandle: "@thsottiaux",
    text: "Reset usage limits for all users tomorrow.",
    createdAt: "2026-10-17T08:00:00.000Z",
  };
  return {
    version: "tibo-evidence-context-v1",
    status: "complete",
    target,
    relatedPosts: depth === 1 ? [parent] : [parent, grandparent],
    edges: depth === 1
      ? [{ fromTweetId: targetId, toTweetId: parentId, relation: "reply" }]
      : [
          { fromTweetId: targetId, toTweetId: parentId, relation: "reply" },
          { fromTweetId: parentId, toTweetId: grandparentId, relation: "reply" },
        ],
    omissions: [],
    lookupCount: depth,
  };
}

test("validated same-author one-hop and two-hop evidence can support an exact future notice", () => {
  for (const depth of [1, 2] as const) {
    const validatedSourceContext = validatedLandingContext(depth);
    const decision = getTiboContextSafetyDecision({
      authorText: "Landing within the next 2 hours.",
      replyContextText: depth === 1 ? "Reset usage limits for all users tomorrow." : "A rollout is on the way.",
      selectedSignalType: "official_notice",
      evidenceQuote: "Landing within the next 2 hours.",
      temporalDirection: "future",
      targetTweetId: "2115000000000000101",
      targetTweetUrl: "https://x.com/thsottiaux/status/2115000000000000101",
      targetTweetCreatedAt: "2026-10-18T08:00:00.000Z",
      validatedSourceContext,
    });

    assert.equal(decision, null, `${depth}-hop evidence should remain attributable to the aligned post`);
  }
});

test("elliptical notices require a matching validated graph and do not bypass negation, BANKED, or history guards", () => {
  const validContext = validatedLandingContext();
  const base = {
    authorText: "Landing within the next 2 hours.",
    replyContextText: "Reset usage limits for all users tomorrow.",
    selectedSignalType: "official_notice" as const,
    evidenceQuote: "Landing within the next 2 hours.",
    temporalDirection: "future" as const,
    targetTweetId: "2115000000000000101",
    targetTweetUrl: "https://x.com/thsottiaux/status/2115000000000000101",
    targetTweetCreatedAt: "2026-10-18T08:00:00.000Z",
  };
  const assertSuppressed = (overrides: Partial<TiboContextSafetyInput>, reason: string) => {
    const decision = getTiboContextSafetyDecision({
      ...base,
      validatedSourceContext: validContext,
      ...overrides,
    });
    assert.equal(decision?.signalType, "irrelevant", reason);
  };

  assertSuppressed({ validatedSourceContext: null }, "missing graph");
  assertSuppressed({ evidenceQuote: "This is not the quote from the target post." }, "misaligned AI evidence");
  assertSuppressed({ targetTweetId: "2115000000000000999" }, "different target ID");
  assertSuppressed({
    validatedSourceContext: validatedLandingContext(1, "@other_user"),
  }, "foreign source author");
  assertSuppressed({
    authorText: "The reset is not landing in the next 2 hours.",
    evidenceQuote: "The reset is not landing in the next 2 hours.",
  }, "negated author statement");
  assertSuppressed({
    replyContextText: "BANKED reset credits are being distributed to users tomorrow.",
    validatedSourceContext: {
      ...validContext,
      relatedPosts: [{
        ...validContext.relatedPosts[0],
        text: "BANKED reset credits are being distributed to users tomorrow.",
      }],
    },
  }, "BANKED distribution");
  assertSuppressed({
    replyContextText: "I will reset usage limits for my account tomorrow.",
    validatedSourceContext: {
      ...validContext,
      relatedPosts: [{
        ...validContext.relatedPosts[0],
        text: "I will reset usage limits for my account tomorrow.",
      }],
    },
  }, "personal reset");
  assertSuppressed({
    replyContextText: "Reset usage limits for all users tomorrow. The product rollout is a separate event.",
    validatedSourceContext: {
      ...validContext,
      relatedPosts: [{
        ...validContext.relatedPosts[0],
        text: "Reset usage limits for all users tomorrow. The product rollout is a separate event.",
      }],
    },
  }, "explicitly different event");
  assertSuppressed({
    replyContextText: "Remember when we reset usage limits? This landing is about another event.",
    validatedSourceContext: {
      ...validContext,
      relatedPosts: [{
        ...validContext.relatedPosts[0],
        text: "Remember when we reset usage limits? This landing is about another event.",
      }],
    },
  }, "historical or unrelated event");
});

test("a completed elliptical phrase does not gain reset execution authority from source context", () => {
  const decision = getTiboContextSafetyDecision({
    authorText: "Done and dusted.",
    replyContextText: "Reset usage limits for all users tomorrow.",
    selectedSignalType: "reset_executed",
    evidenceQuote: "Done and dusted.",
    temporalDirection: "completed_now",
    targetTweetId: "2115000000000000101",
    targetTweetUrl: "https://x.com/thsottiaux/status/2115000000000000101",
    targetTweetCreatedAt: "2026-10-18T08:00:00.000Z",
    validatedSourceContext: validatedLandingContext(),
  });

  assert.equal(decision?.signalType, "irrelevant");
});
