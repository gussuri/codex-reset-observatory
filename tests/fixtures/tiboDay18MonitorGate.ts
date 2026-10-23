/** Persisted source facts for the Day 18 monitor-gate regression. Raw post text
 * is intentionally left in its source record; the gate depends on provenance,
 * not on either post's wording.
 */
export const DAY18_MONITOR_GATE_SOURCE_FACTS = {
  parentTweetId: "2113492187770175603",
  parentBeforeCorrection: {
    signalType: "reset_executed",
    formallyAdopted: true,
  },
  parentAfterCorrection: {
    signalType: "official_notice",
    verificationStatus: "confirmed",
    classificationSource: "manual",
  },
  directReply: {
    tweetId: "2113492502355562875",
    signalType: "official_notice",
    isReply: true,
    temporalDirection: "future",
    windowStartAt: "2026-10-23T15:00:00.000Z",
    windowEndAt: "2026-10-23T18:00:00.000Z",
  },
} as const;
