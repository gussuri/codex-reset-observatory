export const ASTRA_BANKED_HISTORY_EVENT_KEY = "banked-reset-2095651088502591861";
export const ASTRA_BANKED_SECOND_HISTORY_EVENT_KEY = `${ASTRA_BANKED_HISTORY_EVENT_KEY}-observation-20260904T234601897Z`;
export const ASTRA_BANKED_HISTORY_SOURCE_TWEET_ID = "2095651088502591861";
export const GPT61_BANKED_HISTORY_EVENT_KEY = `${ASTRA_BANKED_HISTORY_EVENT_KEY}-observation-20260929T184159778Z`;
export const GPT61_BANKED_HISTORY_TEASER_TWEET_ID = "2104838506363408740";
export const DAY26_BANKED_HISTORY_EVENT_KEY = "banked-reset-local-codex-app-server-observation-20261031T204018257Z";
export const DAY26_BANKED_SECOND_HISTORY_EVENT_KEY = "banked-reset-local-codex-app-server-observation-20261101T221624351Z";
export const DAY26_BANKED_HISTORY_NOTICE_TWEET_ID = "2116405414921384099";

type HistoricalResetTitleTranslationKey =
  | "astraBankedHistoryTitle"
  | "astraBankedHistorySecondTitle"
  | "gpt61BankedHistoryTitle"
  | "day26BankedHistoryTitle"
  | "day26BankedHistoryFirstTitle"
  | "day26BankedHistorySecondTitle";

type HistoricalResetNoteTranslationKey =
  | "astraBankedHistoryNote"
  | "gpt61BankedHistoryNote"
  | "day26BankedHistoryNote"
  | "day26BankedHistorySecondNote";

type HistoricalResetCorrection = {
  correctionId: string;
  scopeCorrectionEventKeys: readonly string[];
  presentationEventKeys: readonly string[];
  sourceTweetId?: string;
  presentation: {
    defaultTitleTranslationKey: HistoricalResetTitleTranslationKey;
    titleTranslationKeysByEventKey: ReadonlyArray<{
      eventKey: string;
      translationKey: HistoricalResetTitleTranslationKey;
    }>;
    reasonType: "ご祝儀リセット";
    noteTranslationKey: HistoricalResetNoteTranslationKey;
    displayScope?: "全有料プラン";
    displayNoticeType?: "匂わせ投稿あり" | "公式予告あり" | "告知投稿あり";
    sourceTweetId?: string;
    hideAnnouncementTiming?: boolean;
    hideSource?: boolean;
  };
};

/**
 * Historical corrections are keyed by known event/source identity, never by
 * post text. Scope correction intentionally has narrower matching than
 * presentation correction because the two have different contracts.
 */
export const HISTORICAL_RESET_CORRECTIONS: readonly HistoricalResetCorrection[] = [
  {
    correctionId: "astra-banked-history",
    scopeCorrectionEventKeys: [
      ASTRA_BANKED_HISTORY_EVENT_KEY,
      ASTRA_BANKED_SECOND_HISTORY_EVENT_KEY,
    ],
    // The second key selects its title after provenance has matched; it was
    // not a standalone presentation matcher in the legacy implementation.
    presentationEventKeys: [ASTRA_BANKED_HISTORY_EVENT_KEY],
    sourceTweetId: ASTRA_BANKED_HISTORY_SOURCE_TWEET_ID,
    presentation: {
      defaultTitleTranslationKey: "astraBankedHistoryTitle",
      titleTranslationKeysByEventKey: [
        {
          eventKey: ASTRA_BANKED_HISTORY_EVENT_KEY,
          translationKey: "astraBankedHistoryTitle",
        },
        {
          eventKey: ASTRA_BANKED_SECOND_HISTORY_EVENT_KEY,
          translationKey: "astraBankedHistorySecondTitle",
        },
      ],
      reasonType: "ご祝儀リセット",
      noteTranslationKey: "astraBankedHistoryNote",
    },
  },
  {
    correctionId: "gpt61-banked-history-observation",
    // The observed GPT-6.1 distribution reached all paid plans and is the
    // completed boundary for its associated teaser.
    scopeCorrectionEventKeys: [GPT61_BANKED_HISTORY_EVENT_KEY],
    presentationEventKeys: [GPT61_BANKED_HISTORY_EVENT_KEY],
    sourceTweetId: GPT61_BANKED_HISTORY_TEASER_TWEET_ID,
    presentation: {
      defaultTitleTranslationKey: "gpt61BankedHistoryTitle",
      titleTranslationKeysByEventKey: [
        {
          eventKey: GPT61_BANKED_HISTORY_EVENT_KEY,
          translationKey: "gpt61BankedHistoryTitle",
        },
      ],
      reasonType: "ご祝儀リセット",
      noteTranslationKey: "gpt61BankedHistoryNote",
      displayNoticeType: "匂わせ投稿あり",
    },
  },
  {
    correctionId: "day26-banked-history-observation",
    scopeCorrectionEventKeys: [DAY26_BANKED_HISTORY_EVENT_KEY],
    presentationEventKeys: [DAY26_BANKED_HISTORY_EVENT_KEY],
    sourceTweetId: DAY26_BANKED_HISTORY_NOTICE_TWEET_ID,
    presentation: {
      defaultTitleTranslationKey: "day26BankedHistoryFirstTitle",
      titleTranslationKeysByEventKey: [
        {
          eventKey: DAY26_BANKED_HISTORY_EVENT_KEY,
          translationKey: "day26BankedHistoryFirstTitle",
        },
      ],
      reasonType: "ご祝儀リセット",
      noteTranslationKey: "day26BankedHistoryNote",
      displayScope: "全有料プラン",
      displayNoticeType: "公式予告あり",
    },
  },
  {
    correctionId: "day26-banked-second-history-observation",
    scopeCorrectionEventKeys: [DAY26_BANKED_SECOND_HISTORY_EVENT_KEY],
    presentationEventKeys: [DAY26_BANKED_SECOND_HISTORY_EVENT_KEY],
    sourceTweetId: DAY26_BANKED_HISTORY_NOTICE_TWEET_ID,
    presentation: {
      defaultTitleTranslationKey: "day26BankedHistorySecondTitle",
      titleTranslationKeysByEventKey: [
        {
          eventKey: DAY26_BANKED_SECOND_HISTORY_EVENT_KEY,
          translationKey: "day26BankedHistorySecondTitle",
        },
      ],
      reasonType: "ご祝儀リセット",
      noteTranslationKey: "day26BankedHistorySecondNote",
      displayScope: "全有料プラン",
      displayNoticeType: "公式予告あり",
    },
  },
];

export type HistoricalResetPresentationLookup = {
  recordKind?: string | null;
  eventKey?: string | null;
  officialNoticeTweetId?: string | null;
  sourceTweetIds?: ReadonlyArray<string | null | undefined> | null;
};

export type HistoricalResetPresentationCorrection = {
  correctionId: string;
  titleTranslationKey: HistoricalResetTitleTranslationKey;
  reasonType: "ご祝儀リセット";
  noteTranslationKey: HistoricalResetNoteTranslationKey;
  displayScope?: "全有料プラン";
  displayNoticeType?: "匂わせ投稿あり" | "公式予告あり" | "告知投稿あり";
  sourceTweetId?: string;
  hideAnnouncementTiming?: boolean;
  hideSource?: boolean;
};

export function hasHistoricalResetScopeCorrection(eventKey: string | null | undefined) {
  return typeof eventKey === "string" && HISTORICAL_RESET_CORRECTIONS.some((correction) =>
    correction.scopeCorrectionEventKeys.includes(eventKey),
  );
}

export function getHistoricalResetPresentationCorrection(
  input: HistoricalResetPresentationLookup,
): HistoricalResetPresentationCorrection | null {
  if (input.recordKind !== "banked_distribution") return null;

  const eventKey = input.eventKey ?? null;
  const officialNoticeTweetId = input.officialNoticeTweetId?.trim();
  const exactEventCorrection = eventKey
    ? HISTORICAL_RESET_CORRECTIONS.find((candidate) =>
      candidate.presentationEventKeys.includes(eventKey),
    )
    : undefined;
  const sourceCorrection = HISTORICAL_RESET_CORRECTIONS.find((candidate) =>
    candidate.sourceTweetId !== undefined && (
      officialNoticeTweetId === candidate.sourceTweetId ||
      (input.sourceTweetIds?.includes(candidate.sourceTweetId) ?? false)
    ),
  );
  const correction = exactEventCorrection ?? sourceCorrection;
  if (!correction) return null;

  const exactTitle = eventKey !== null
    ? correction.presentation.titleTranslationKeysByEventKey.find((entry) => entry.eventKey === eventKey)
    : undefined;

  return {
    correctionId: correction.correctionId,
    titleTranslationKey: exactTitle?.translationKey ?? correction.presentation.defaultTitleTranslationKey,
    reasonType: correction.presentation.reasonType,
    noteTranslationKey: correction.presentation.noteTranslationKey,
    displayScope: correction.presentation.displayScope,
    displayNoticeType: correction.presentation.displayNoticeType,
    sourceTweetId: correction.sourceTweetId,
    hideAnnouncementTiming: correction.presentation.hideAnnouncementTiming,
    hideSource: correction.presentation.hideSource,
  };
}
