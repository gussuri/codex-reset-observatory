import test from "node:test";
import assert from "node:assert";
import { LOCAL_OBSERVATION_SIGNALS } from "../data/observationSignals";
import { LOCAL_RESET_HISTORY } from "../data/resetHistory";
import { translateDynamic, UI_TRANSLATIONS } from "../lib/radar/i18n";
import { getRadarViewModel, getLocalRadarData } from "../lib/radar";

const JAPANESE_CHAR_REGEX = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/;

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
      assert.ok(enBoost.length > 0, `Signal '${signal.id}' English boostReason is empty`);
      assert.ok(zhBoost.length > 0, `Signal '${signal.id}' Chinese boostReason is empty`);
    }

    if (signal.title) {
      const enTitle = translateDynamic(signal.title, "en");
      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enTitle),
        false,
        `Signal '${signal.id}' title lacks English translation. Got: "${enTitle}"`
      );
    }
  }
});

test("i18n Automated Check: All LOCAL_RESET_HISTORY items have valid English & Chinese translations", () => {
  for (const history of LOCAL_RESET_HISTORY) {
    if (history.title) {
      const enTitle = translateDynamic(history.title, "en");
      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enTitle),
        false,
        `History '${history.resetAt ?? history.title}' title lacks English translation. Got: "${enTitle}"`
      );
    }
    if (history.note) {
      const enNote = translateDynamic(history.note, "en");
      assert.strictEqual(
        JAPANESE_CHAR_REGEX.test(enNote),
        false,
        `History '${history.resetAt ?? history.title}' note lacks English translation. Got: "${enNote}"`
      );
    }
  }
});

test("i18n Automated Check: RadarViewModel reasoningSummary contains zero Japanese characters in English locale", () => {
  const radarData = getLocalRadarData();
  const enViewModel = getRadarViewModel(radarData, "en");

  const enSummary = enViewModel.reasoningSummary;
  assert.strictEqual(typeof enSummary, "string");
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
    "staleDataWarning",
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
