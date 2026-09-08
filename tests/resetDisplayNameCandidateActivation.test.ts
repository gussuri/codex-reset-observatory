import assert from "node:assert/strict";
import test from "node:test";
import {
  isResetDisplayNameCandidateNoticeAfterAdoption,
  readResetDisplayNameCandidateActivation,
} from "../lib/radar/resetDisplayNameCandidateActivation";

test("missing activation configuration fails closed to off", () => {
  assert.deepEqual(readResetDisplayNameCandidateActivation({}), { mode: "off", adoptionAt: null });
});

test("invalid mode or cutoff fails closed to off", () => {
  assert.deepEqual(
    readResetDisplayNameCandidateActivation({
      RESET_DISPLAY_NAME_CANDIDATE_MODE: "unsafe",
      RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT: "2026-09-08T00:00:00.000Z",
    }),
    { mode: "off", adoptionAt: null },
  );
  assert.deepEqual(
    readResetDisplayNameCandidateActivation({
      RESET_DISPLAY_NAME_CANDIDATE_MODE: "seed",
      RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT: "not-a-date",
    }),
    { mode: "off", adoptionAt: null },
  );
});

test("seed activation requires a valid adoption cutoff", () => {
  assert.deepEqual(
    readResetDisplayNameCandidateActivation({
      RESET_DISPLAY_NAME_CANDIDATE_MODE: "seed",
      RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT: "2026-09-08T00:00:00.000Z",
    }),
    { mode: "seed", adoptionAt: "2026-09-08T00:00:00.000Z" },
  );
});

test("full activation requires a valid adoption cutoff", () => {
  assert.deepEqual(
    readResetDisplayNameCandidateActivation({
      RESET_DISPLAY_NAME_CANDIDATE_MODE: "full",
      RESET_DISPLAY_NAME_CANDIDATE_ADOPTION_AT: "2026-09-08T00:00:00.000Z",
    }),
    { mode: "full", adoptionAt: "2026-09-08T00:00:00.000Z" },
  );
});

test("notice cutoff is inclusive and uses tweet_created_at", () => {
  const adoptionAt = "2026-09-08T00:00:00.000Z";
  assert.equal(isResetDisplayNameCandidateNoticeAfterAdoption(adoptionAt, adoptionAt), true);
  assert.equal(
    isResetDisplayNameCandidateNoticeAfterAdoption("2026-09-07T23:59:59.999Z", adoptionAt),
    false,
  );
  assert.equal(
    isResetDisplayNameCandidateNoticeAfterAdoption("2026-09-08T00:00:00.001Z", adoptionAt),
    true,
  );
});

test("invalid notice timestamps are never eligible", () => {
  assert.equal(
    isResetDisplayNameCandidateNoticeAfterAdoption("not-a-date", "2026-09-08T00:00:00.000Z"),
    false,
  );
  assert.equal(
    isResetDisplayNameCandidateNoticeAfterAdoption("2026-09-08T00:00:00.000Z", "not-a-date"),
    false,
  );
});
