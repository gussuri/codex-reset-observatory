import test from "node:test";
import assert from "node:assert";
import { LOCAL_OBSERVATION_SIGNALS } from "../data/observationSignals";
import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { translateDynamic, UI_TRANSLATIONS } from "../lib/radar/i18n";
import { getRadarViewModel, getLocalRadarData } from "../lib/radar";

const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;
const JAPANESE_KANA_REGEX = /[\u3040-\u309F\u30A0-\u30FF]/;

test("i18n Automated Check: All LOCAL_OBSERVATION_SIGNALS have full English & Chinese translations", () => {
  for (const signal of LOCAL_OBSERVATION_SIGNALS) {
    if (signal.boostReason) {
      const enBoost = translateDynamic(signal.boostReason, "en");
      const zhBoost = translateDynamic(signal.boostReason, "zh");

      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enBoost),
        false,
        `Signal '${signal.id}' boostReason lacks English translation. Got: "${enBoost}"`
      );
      assert.strictEqual(
        JAPANESE_KANA_REGEX.test(zhBoost),
        false,
        `Signal '${signal.id}' boostReason contains Japanese kana in Chinese. Got: "${zhBoost}"`
      );
      assert.ok(enBoost.length > 0, `Signal '${signal.id}' English boostReason is empty`);
      assert.ok(zhBoost.length > 0, `Signal '${signal.id}' Chinese boostReason is empty`);
    }

    if (signal.title) {
      const enTitle = translateDynamic(signal.title, "en");
      const zhTitle = translateDynamic(signal.title, "zh");
      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enTitle),
        false,
        `Signal '${signal.id}' title lacks English translation. Got: "${enTitle}"`
      );
      assert.strictEqual(
        JAPANESE_KANA_REGEX.test(zhTitle),
        false,
        `Signal '${signal.id}' title contains Japanese kana in Chinese. Got: "${zhTitle}"`
      );
    }
  }
});

test("i18n Automated Check: All LOCAL_RESET_HISTORY items have valid English & Chinese translations", () => {
  for (const history of LOCAL_RESET_HISTORY) {
    const historyIdentifier = history.id ?? history.title;
    const historyDate = history.completed_at ?? history.closed_at ?? history.opened_at;
    const historyLabel = historyIdentifier ?? historyDate;

    if (history.title) {
      const enTitle = translateDynamic(history.title, "en");
      const zhTitle = translateDynamic(history.title, "zh");
      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enTitle),
        false,
        `History '${historyLabel}' title lacks English translation. Got: "${enTitle}"`
      );
      assert.strictEqual(
        JAPANESE_KANA_REGEX.test(zhTitle),
        false,
        `History '${historyLabel}' title contains Japanese kana in Chinese. Got: "${zhTitle}"`
      );
    }
    if (history.details) {
      if (history.details.noticeType) {
        const enNotice = translateDynamic(history.details.noticeType, "en");
        const zhNotice = translateDynamic(history.details.noticeType, "zh");
        assert.strictEqual(
          JAPANESE_CHAR_REGEX.test(enNotice),
          false,
          `History '${historyLabel}' noticeType lacks English translation. Got: "${enNotice}"`
        );
        assert.strictEqual(
          JAPANESE_KANA_REGEX.test(zhNotice),
          false,
          `History '${historyLabel}' noticeType contains Japanese kana in Chinese. Got: "${zhNotice}"`
        );
      }
      if (history.details.cycleType) {
        const enCycle = translateDynamic(history.details.cycleType, "en");
        const zhCycle = translateDynamic(history.details.cycleType, "zh");
        assert.strictEqual(
          JAPANESE_CHAR_REGEX.test(enCycle),
          false,
          `History '${historyLabel}' cycleType lacks English translation. Got: "${enCycle}"`
        );
        assert.strictEqual(
          JAPANESE_KANA_REGEX.test(zhCycle),
          false,
          `History '${historyLabel}' cycleType contains Japanese kana in Chinese. Got: "${zhCycle}"`
        );
      }
      if (history.details.reasonType) {
        const enReason = translateDynamic(history.details.reasonType, "en");
        const zhReason = translateDynamic(history.details.reasonType, "zh");
        assert.strictEqual(
          JAPANESE_CHAR_REGEX.test(enReason),
          false,
          `History '${historyLabel}' reasonType lacks English translation. Got: "${enReason}"`
        );
        assert.strictEqual(
          JAPANESE_KANA_REGEX.test(zhReason),
          false,
          `History '${historyLabel}' reasonType contains Japanese kana in Chinese. Got: "${zhReason}"`
        );
      }
      if (history.details.resetMethod) {
        const enMethod = translateDynamic(history.details.resetMethod, "en");
        const zhMethod = translateDynamic(history.details.resetMethod, "zh");
        assert.strictEqual(
          JAPANESE_CHAR_REGEX.test(enMethod),
          false,
          `History '${historyLabel}' resetMethod lacks English translation. Got: "${enMethod}"`
        );
        assert.strictEqual(
          JAPANESE_KANA_REGEX.test(zhMethod),
          false,
          `History '${historyLabel}' resetMethod contains Japanese kana in Chinese. Got: "${zhMethod}"`
        );
      }
      if (history.details.scope) {
        const enScope = translateDynamic(history.details.scope, "en");
        const zhScope = translateDynamic(history.details.scope, "zh");
        assert.strictEqual(
          JAPANESE_CHAR_REGEX.test(enScope),
          false,
          `History '${historyLabel}' scope lacks English translation. Got: "${enScope}"`
        );
        assert.strictEqual(
          JAPANESE_KANA_REGEX.test(zhScope),
          false,
          `History '${historyLabel}' scope contains Japanese kana in Chinese. Got: "${zhScope}"`
        );
      }
    }
    const historyNote = history.details?.note;
    if (historyNote) {
      const enNote = translateDynamic(historyNote, "en");
      const zhNote = translateDynamic(historyNote, "zh");
      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enNote),
        false,
        `History '${historyLabel}' note lacks English translation. Got: "${enNote}"`
      );
      assert.strictEqual(
        JAPANESE_KANA_REGEX.test(zhNote),
        false,
        `History '${historyLabel}' note contains Japanese kana in Chinese. Got: "${zhNote}"`
      );
    }
  }
});

test("i18n Automated Check: Common history noticeType values have valid English & Chinese translations", () => {
  const noticeTypes = [
    "公式予告あり",
    "公式告知あり",
    "告知投稿あり",
    "匂わせ投稿あり",
    "予告あり",
    "予告なし",
    "なし",
  ];

  for (const notice of noticeTypes) {
    const enNotice = translateDynamic(notice, "en");
    const zhNotice = translateDynamic(notice, "zh");

    assert.strictEqual(
      JAPANESE_CHAR_REGEX.test(enNotice),
      false,
      `Notice type '${notice}' lacks English translation. Got: "${enNotice}"`
    );
    assert.ok(enNotice.length > 0, `Notice type '${notice}' English translation is empty`);
    assert.ok(zhNotice.length > 0, `Notice type '${notice}' Chinese translation is empty`);
  }
});

test("i18n Automated Check: RadarViewModel reasoningSummary contains zero Japanese characters in English locale", () => {
  const radarData = getLocalRadarData();
  const enViewModel = getRadarViewModel(radarData, "en");

  const enSummary = enViewModel.reasoningSummary;
  assert.ok(enSummary);
  assert.strictEqual(
    JAPANESE_CHAR_REGEX.test(enSummary),
    false,
    `RadarViewModel English reasoningSummary contains un-translated Japanese text. Got: "${enSummary}"`
  );

  const zhViewModel = getRadarViewModel(radarData, "zh");
  assert.strictEqual(typeof zhViewModel.reasoningSummary, "string");
});

test("i18n Automated Check: data-state warnings are complete for every locale", () => {
  const warningKeys = [
    "degradedDataWarning",
    "dataUnavailable",
    "lastSuccessfulRefresh",
    "unknownProbability",
    "noticePostedAt",
  ];

  for (const key of warningKeys) {
    const translations = UI_TRANSLATIONS[key];

    for (const locale of ["ja", "en", "zh"] as const) {
      assert.ok(
        translations?.[locale]?.trim(),
        `${key} ${locale} translation is empty`,
      );
    }

    assert.strictEqual(
      JAPANESE_CHAR_REGEX.test(translations.en),
      false,
      `${key} English translation contains Japanese characters. Got: "${translations.en}"`,
    );
  }
});
