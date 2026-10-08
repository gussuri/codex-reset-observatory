import assert from "node:assert/strict";
import test from "node:test";

import {
  BANKED_POST_ASSOCIATION_VERSION,
  matchBankedObservationToPosts,
  normalizeBankedPostClaim,
  normalizeBankedPostClaims,
  type BankedGrantObservationForMatching,
} from "../lib/radar/resetPostAssociation";
import type { ActiveTiboSignal } from "../lib/radar/types";

function signal(overrides: Partial<ActiveTiboSignal> = {}): ActiveTiboSignal {
  return {
    tweet_id: "notice-one",
    signal_type: "official_notice",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro and Business users.",
    tweet_url: "https://x.com/thsottiaux/status/notice-one",
    tweet_created_at: "2026-10-07T19:19:17.000Z",
    expires_at: "2026-10-08T19:19:17.000Z",
    verification_status: "confirmed",
    confidence: 0.99,
    classification_source: "manual",
    temporal_kind: "none",
    temporal_precision: "unknown",
    temporal_resolution_status: "unresolved",
    ...overrides,
  };
}

function observation(overrides: Partial<BankedGrantObservationForMatching> = {}): BankedGrantObservationForMatching {
  return {
    observationKey: "banked-grant:local-codex-app-server:codex:2026-10-07T23:12:28.952Z",
    resetEventKey: "banked-reset-observation-20261007T231228952Z",
    sourceKey: "local-codex-app-server",
    limitId: "codex",
    planType: "plus",
    previousObservedAt: "2026-10-07T19:10:00.000Z",
    observedAt: "2026-10-07T23:12:28.952Z",
    receivedAt: "2026-10-07T23:12:30.000Z",
    previousAvailableCount: 0,
    currentAvailableCount: 1,
    ...overrides,
  };
}

function normalize(signals: ActiveTiboSignal[], observedAt = observation().observedAt) {
  return signals.map((item) => normalizeBankedPostClaim(item, { observedAt }));
}

test("matcher has a stable explicit version", () => {
  assert.equal(BANKED_POST_ASSOCIATION_VERSION, "banked-post-association-v1");
});

test("does not associate a new grant with the ended September Astra notice", () => {
  const ended = signal({
    tweet_id: "2095651088502591861",
    text: "We will give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan, starting today.",
    tweet_created_at: "2026-09-04T18:00:00.000Z",
  });
  const decision = matchBankedObservationToPosts(observation(), normalize([ended]));

  assert.equal(decision.status, "pending");
  assert.equal(decision.reason, "no_current_lifecycle_match");
  assert.deepEqual(decision.eligibleCandidateIds, []);
  assert.deepEqual(decision.excludedCandidates, [{ tweetId: ended.tweet_id, reason: "terminated_before_observation" }]);
});

test("accepts the corrected 40M loading notice 3h53m after it was announced", () => {
  const fortyMillion = signal({
    tweet_id: "2107913674593644711",
    tweet_created_at: "2026-10-07T19:19:17.000Z",
    expires_at: "2026-10-08T19:19:17.000Z",
  });
  const grant = observation();
  const decision = matchBankedObservationToPosts(grant, normalize([fortyMillion]));

  assert.equal(decision.status, "accepted");
  assert.equal(decision.reason, "unique_active_distribution_claim");
  assert.equal(decision.noticeTweetId, fortyMillion.tweet_id);
  assert.equal(decision.logicalPostId, fortyMillion.tweet_id);
  assert.equal(decision.observationKey, grant.observationKey);
  assert.equal(Date.parse(grant.observedAt) - Date.parse(fortyMillion.tweet_created_at), 13_991_952);
});

test("does not match an explicitly negated BANKED loading claim", () => {
  const negated = signal({
    tweet_id: "negated-loading",
    text: "We are not loading a BANKED reset into all accounts of Plus, Pro and Business users.",
  });
  const claim = normalizeBankedPostClaim(negated, { observedAt: observation().observedAt });
  const decision = matchBankedObservationToPosts(observation(), [claim]);

  assert.equal(claim.eligible, false);
  assert.equal(claim.exclusionReason, "claim_negated_or_cancelled");
  assert.equal(decision.status, "pending");
  assert.equal(decision.noticeTweetId, null);
});

test("association audit omits unrelated timeline posts but retains rejected BANKED claims", () => {
  const unrelated = signal({
    tweet_id: "unrelated-post",
    signal_type: "irrelevant",
    text: "The new model is now available.",
  });
  const rejectedBanked = signal({
    tweet_id: "unverified-banked-post",
    signal_type: "teaser",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro and Business users.",
  });
  const claims = normalize([unrelated, rejectedBanked]);
  const decision = matchBankedObservationToPosts(observation(), claims);

  assert.equal(decision.status, "pending");
  assert.deepEqual(decision.excludedCandidates, [{
    tweetId: "unverified-banked-post",
    reason: "not_official_notice",
  }]);
});

test("a later correction cancelling the same BANKED distribution prevents acceptance", () => {
  const corrected = signal({
    tweet_id: "cancelled-update",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro and Business users. Update: this distribution has been cancelled.",
  });
  const claim = normalizeBankedPostClaim(corrected, { observedAt: observation().observedAt });

  assert.equal(claim.eligible, false);
  assert.equal(claim.exclusionReason, "claim_negated_or_cancelled");
  assert.equal(matchBankedObservationToPosts(observation(), [claim]).status, "pending");
});

test("a distribution limited to Plus is not published as an all-paid BANKED event", () => {
  const plusOnly = signal({
    tweet_id: "plus-only",
    text: "Currently distributing a BANKED reset to all Plus users.",
  });
  const claim = normalizeBankedPostClaim(plusOnly, { observedAt: observation().observedAt });
  const plusDecision = matchBankedObservationToPosts(observation({ planType: "plus" }), [claim]);
  const proDecision = matchBankedObservationToPosts(observation({ planType: "pro" }), [claim]);

  assert.equal(claim.eligible, false);
  assert.equal(claim.scope, "conditional");
  assert.equal(plusDecision.status, "pending");
  assert.equal(proDecision.status, "pending");
  assert.deepEqual(plusDecision.excludedCandidates, [{
    tweetId: "plus-only",
    reason: "scope_unverified_or_conditional",
  }]);
});

test("an Oxford-comma Plus, Pro, and Business enumeration proves all-paid scope", () => {
  const fullPaidScope = signal({
    tweet_id: "all-paid-oxford-comma",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
  });
  const claim = normalizeBankedPostClaim(fullPaidScope, { observedAt: observation().observedAt });

  assert.deepEqual(claim.coveredPlanTypes, ["plus", "pro", "business"]);
  assert.equal(claim.scope, "all_paid");
  assert.equal(claim.eligible, true);
  for (const planType of ["plus", "pro", "business"]) {
    assert.equal(matchBankedObservationToPosts(observation({ planType }), [claim]).status, "accepted");
  }
});

test("an unresolved tomorrow loading schedule stays pending, but a separate tomorrow farewell does not block a completed distribution", () => {
  const futureLoading = signal({
    tweet_id: "tomorrow-loading",
    text: "Tomorrow we are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    temporal_kind: "relative_day",
    temporal_precision: "day",
    temporal_resolution_status: "unresolved",
    expected_start_at: null,
    expected_end_at: null,
  });
  const unresolvedClaim = normalizeBankedPostClaim(futureLoading, { observedAt: observation().observedAt });
  assert.equal(unresolvedClaim.eligible, false);
  assert.equal(unresolvedClaim.exclusionReason, "scheduled_claim_unresolved");
  assert.equal(matchBankedObservationToPosts(observation(), [unresolvedClaim]).status, "pending");

  const actualFortyMillionPost = signal({
    tweet_id: "forty-million-with-farewell",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro, and Business users. First one landed a few hours ago. See you again tomorrow!",
    temporal_kind: "relative_day",
    temporal_precision: "exact_time",
    temporal_resolution_status: "resolved",
    expected_start_at: "2026-10-07T22:30:00.000Z",
    expected_end_at: "2026-10-07T23:00:00.000Z",
  });
  const actualClaim = normalizeBankedPostClaim(actualFortyMillionPost, { observedAt: observation().observedAt });
  assert.equal(actualClaim.eligible, true);
  assert.equal(matchBankedObservationToPosts(observation(), [actualClaim]).status, "accepted");
});

test("a broad audience in a separate greeting clause does not prove distribution scope", () => {
  const unrelatedEveryone = signal({
    tweet_id: "unrelated-everyone-scope",
    text: "Thanks everyone! Currently distributing a BANKED reset to affected accounts.",
  });
  const claim = normalizeBankedPostClaim(unrelatedEveryone, { observedAt: observation().observedAt });

  assert.equal(claim.scope, "conditional");
  assert.equal(claim.eligible, false);
  assert.equal(claim.exclusionReason, "scope_unverified_or_conditional");
  assert.equal(matchBankedObservationToPosts(observation(), [claim]).status, "pending");
});

test("future loading schedule in source text stays pending without usable temporal metadata", () => {
  const tomorrowWithoutMetadata = signal({
    tweet_id: "tomorrow-loading-no-temporal-fields",
    text: "Tomorrow we are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    temporal_kind: null,
    temporal_precision: null,
    temporal_resolution_status: null,
    expected_start_at: null,
    expected_end_at: null,
  });
  const tomorrowClaim = normalizeBankedPostClaim(tomorrowWithoutMetadata, { observedAt: observation().observedAt });

  assert.equal(tomorrowClaim.eligible, false);
  assert.equal(tomorrowClaim.exclusionReason, "scheduled_claim_unresolved");
  assert.equal(matchBankedObservationToPosts(observation(), [tomorrowClaim]).status, "pending");

  const explicitDateButUnresolved = signal({
    tweet_id: "october-fifteenth-loading-unresolved",
    text: "On October 15 we are loading a BANKED reset into all accounts of Plus, Pro, and Business users.",
    temporal_kind: "absolute",
    temporal_precision: "day",
    temporal_resolution_status: "unresolved",
    expected_start_at: null,
    expected_end_at: null,
  });
  const dateClaim = normalizeBankedPostClaim(explicitDateButUnresolved, { observedAt: observation().observedAt });

  assert.equal(dateClaim.eligible, false);
  assert.equal(dateClaim.exclusionReason, "scheduled_claim_unresolved");
  assert.equal(matchBankedObservationToPosts(observation(), [dateClaim]).status, "pending");
});

test("an exact scheduled time is matched against the full observation interval", () => {
  const exact = signal({
    temporal_kind: "absolute",
    temporal_precision: "exact_time",
    temporal_resolution_status: "resolved",
    expected_start_at: "2026-10-07T23:00:00.000Z",
    expected_end_at: "2026-10-07T23:00:00.000Z",
  });
  const grant = observation({
    previousObservedAt: "2026-10-07T22:59:00.000Z",
    observedAt: "2026-10-07T23:01:00.000Z",
  });
  const decision = matchBankedObservationToPosts(grant, normalize([exact]));

  assert.equal(decision.status, "accepted");
  assert.equal(decision.reason, "unique_active_distribution_claim");
});

test("auto-unverified claims below the canonical 0.95 confidence floor stay pending", () => {
  const weak = signal({
    tweet_id: "low-confidence",
    classification_source: "gemini",
    verification_status: "auto_unverified",
    confidence: 0.91,
  });
  const claim = normalizeBankedPostClaim(weak, { observedAt: observation().observedAt });
  const decision = matchBankedObservationToPosts(observation(), [claim]);

  assert.equal(claim.exclusionReason, "rejected_or_low_confidence");
  assert.equal(decision.status, "pending");
});

test("normalization uses the latest effective content of a trusted edit chain", () => {
  const previous = signal({
    tweet_id: "1001",
    logical_post_id: "1001",
    edit_history_tweet_ids: ["1001", "1002"],
    edit_version: 1,
    edit_metadata_source: "x_api",
  });
  const latest = signal({
    tweet_id: "1002",
    logical_post_id: "1001",
    edit_history_tweet_ids: ["1001", "1002"],
    edit_version: 2,
    edit_metadata_source: "x_api",
    text: "We are not loading a BANKED reset into all accounts of Plus, Pro and Business users.",
  });
  const claims = normalizeBankedPostClaims([previous, latest], { observedAt: observation().observedAt });
  const decision = matchBankedObservationToPosts(observation(), claims);

  assert.equal(claims.length, 1);
  assert.equal(claims[0].tweetId, "1002");
  assert.equal(claims[0].claimKind, "not_banked_distribution");
  assert.equal(claims[0].eligible, false);
  assert.equal(decision.status, "pending");
});

test("a missing authoritative edit tail cannot make the old positive version eligible", () => {
  const incomplete = signal({
    tweet_id: "1101",
    logical_post_id: "1101",
    edit_history_tweet_ids: ["1101", "1102"],
    edit_version: 1,
    edit_metadata_source: "x_api",
  });
  const claims = normalizeBankedPostClaims([incomplete], { observedAt: observation().observedAt });
  const decision = matchBankedObservationToPosts(observation(), claims);

  assert.equal(claims.length, 1);
  assert.equal(claims[0].eligible, false);
  assert.equal(claims[0].exclusionReason, "edit_chain_unresolved");
  assert.equal(decision.status, "pending");
});

test("conflicting manual edit classifications stay pending", () => {
  const first = signal({
    tweet_id: "1201",
    logical_post_id: "1201",
    edit_history_tweet_ids: ["1201", "1202"],
    edit_version: 1,
    edit_metadata_source: "x_api",
    classification_source: "manual",
  });
  const second = signal({
    tweet_id: "1202",
    logical_post_id: "1201",
    edit_history_tweet_ids: ["1201", "1202"],
    edit_version: 2,
    edit_metadata_source: "x_api",
    classification_source: "manual",
    signal_type: "irrelevant",
    text: "We are loading a BANKED reset into all accounts of Plus, Pro and Business users.",
  });
  const claims = normalizeBankedPostClaims([first, second], { observedAt: observation().observedAt });
  const decision = matchBankedObservationToPosts(observation(), claims);

  assert.equal(decision.status, "pending");
  assert.equal(decision.noticeTweetId, null);
  assert.ok(claims.every((claim) => !claim.eligible));
});

test("uses observation time for lifecycle boundaries and keeps end exclusive", () => {
  const notice = signal({
    tweet_created_at: "2026-10-07T19:19:17.000Z",
    expires_at: "2026-10-07T23:12:28.952Z",
  });
  const beforeEnd = matchBankedObservationToPosts(observation({
    observedAt: "2026-10-07T23:12:28.951Z",
    receivedAt: "2026-10-08T00:10:00.000Z",
  }), normalizeBankedPostClaim(notice, { observedAt: "2026-10-07T23:12:28.951Z" }) ? [normalizeBankedPostClaim(notice, { observedAt: "2026-10-07T23:12:28.951Z" })] : []);
  const atEnd = matchBankedObservationToPosts(observation({
    observedAt: "2026-10-07T23:12:28.952Z",
    receivedAt: "2026-10-08T00:10:00.000Z",
  }), [normalizeBankedPostClaim(notice, { observedAt: "2026-10-07T23:12:28.952Z" })]);

  assert.equal(beforeEnd.status, "accepted");
  assert.equal(atEnd.status, "pending");
  assert.equal(atEnd.reason, "no_current_lifecycle_match");
});

test("allows a late delivery observed before the notice ends", () => {
  const notice = signal({ expires_at: "2026-10-07T23:30:00.000Z" });
  const decision = matchBankedObservationToPosts(observation({
    observedAt: "2026-10-07T23:20:00.000Z",
    receivedAt: "2026-10-09T00:00:00.000Z",
  }), normalize([notice]));

  assert.equal(decision.status, "accepted");
});

test("a recurring notice may support distinct later grant observations without merging their identities", () => {
  const recurring = signal({
    tweet_id: "recurring-notice",
    text: "We will distribute a BANKED reset every week to all paid users.",
    tweet_created_at: "2026-10-01T00:00:00.000Z",
    expires_at: "2026-11-01T00:00:00.000Z",
  });
  const first = observation({ observedAt: "2026-10-07T23:12:28.952Z" });
  const second = observation({
    observationKey: "banked-grant:local-codex-app-server:codex:2026-10-14T23:12:28.952Z",
    resetEventKey: "banked-reset-observation-20261014T231228952Z",
    previousObservedAt: "2026-10-14T19:10:00.000Z",
    observedAt: "2026-10-14T23:12:28.952Z",
    receivedAt: "2026-10-14T23:12:30.000Z",
  });
  const claims = normalize([recurring], first.observedAt);

  const firstDecision = matchBankedObservationToPosts(first, claims);
  const secondDecision = matchBankedObservationToPosts(second, normalize([recurring], second.observedAt));

  assert.equal(firstDecision.status, "accepted");
  assert.equal(secondDecision.status, "accepted");
  assert.notEqual(firstDecision.observationKey, secondDecision.observationKey);
  assert.notEqual(first.resetEventKey, second.resetEventKey);
  assert.equal(firstDecision.noticeTweetId, secondDecision.noticeTweetId);
});

test("does not treat unknown scope or conditional eligibility as all-paid evidence", () => {
  const conditional = signal({
    tweet_id: "conditional-notice",
    text: "We will give one banked reset for every day you don't have access to Astra on your paid ChatGPT plan.",
  });
  const noScope = signal({
    tweet_id: "unknown-scope-notice",
    text: "We will distribute a BANKED reset soon.",
  });

  for (const candidate of [conditional, noScope]) {
    const decision = matchBankedObservationToPosts(observation(), normalize([candidate]));
    assert.equal(decision.status, "pending");
    assert.notEqual(decision.noticeTweetId, candidate.tweet_id);
  }
});

test("an unresolved future notice remains pending instead of matching a completed grant", () => {
  const future = signal({
    temporal_kind: "relative_day",
    temporal_precision: "day",
    temporal_resolution_status: "unresolved",
    expected_start_at: null,
    expected_end_at: null,
    text: "A BANKED reset will be distributed tomorrow to all paid users.",
  });
  const decision = matchBankedObservationToPosts(observation(), normalize([future]));

  assert.equal(decision.status, "pending");
  assert.equal(decision.reason, "scheduled_claim_unresolved");
});

test("two independent eligible notices stay pending instead of choosing by recency or confidence", () => {
  const older = signal({ tweet_id: "older", confidence: 0.96 });
  const newer = signal({ tweet_id: "newer", confidence: 1, tweet_created_at: "2026-10-07T20:00:00.000Z" });
  const decision = matchBankedObservationToPosts(observation(), normalize([newer, older]));

  assert.equal(decision.status, "pending");
  assert.equal(decision.reason, "multiple_eligible_claims");
  assert.deepEqual(decision.eligibleCandidateIds, ["newer", "older"]);
});

test("an exact schedule must overlap the observed interval and uses precision", () => {
  const exact = signal({
    temporal_kind: "absolute",
    temporal_precision: "exact_time",
    temporal_resolution_status: "resolved",
    expected_start_at: "2026-10-07T23:12:00.000Z",
    expected_end_at: "2026-10-07T23:13:00.000Z",
  });
  const decision = matchBankedObservationToPosts(observation(), normalize([exact]));

  assert.equal(decision.status, "accepted");
  const outside = matchBankedObservationToPosts(observation({
    previousObservedAt: "2026-10-07T22:00:00.000Z",
    observedAt: "2026-10-07T23:12:28.952Z",
  }), normalize([signal({ ...exact, expected_start_at: "2026-10-07T20:00:00.000Z", expected_end_at: "2026-10-07T20:01:00.000Z" })]));
  assert.equal(outside.status, "pending");
  assert.equal(outside.reason, "schedule_does_not_overlap_observation");
});

test("a trusted edit chain is one logical claim while reply and quote claims are excluded", () => {
  const edited = signal({
    tweet_id: "edited-v2",
    logical_post_id: "edited-v1",
    edit_history_tweet_ids: ["edited-v1", "edited-v2"],
    edit_version: 2,
    edit_metadata_source: "x_api",
  });
  const reply = signal({ tweet_id: "reply-claim", is_reply: true });
  const quote = signal({ tweet_id: "quote-claim", is_quote: true });
  const claims = normalize([reply, quote, edited]);
  const decision = matchBankedObservationToPosts(observation(), claims);

  assert.equal(decision.status, "accepted");
  assert.equal(decision.logicalPostId, "edited-v1");
  assert.deepEqual(decision.eligibleCandidateIds, ["edited-v1"]);
  assert.deepEqual(decision.excludedCandidates.map((item) => item.reason).sort(), ["reply_or_quote", "reply_or_quote"]);
});

test("a manual accepted association is not silently replaced by a different automatic notice", () => {
  const decision = matchBankedObservationToPosts(
    observation(),
    normalize([signal({ tweet_id: "newer-notice" })]),
    { protectedAssociation: { noticeTweetId: "manual-notice", provenance: "manual" } },
  );

  assert.equal(decision.status, "conflict");
  assert.equal(decision.reason, "manual_association_protected");
  assert.equal(decision.noticeTweetId, "manual-notice");
});
