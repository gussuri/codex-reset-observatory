export type TiboTranslationLocale = "ja" | "zh";

export type TiboTranslationValidationReason =
  | "valid"
  | "missing"
  | "too_long"
  | "same_as_source"
  | "missing_locale_script";

export type TiboTranslationValidation = {
  valid: boolean;
  normalized: string | null;
  reason: TiboTranslationValidationReason;
};

export const TIBO_TRANSLATION_MAX_CHARS = 6000;

/** Normalizes a stored/generated translation without changing its line breaks. */
export function normalizeTiboTranslationValue(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  if (!normalized || normalized.length > TIBO_TRANSLATION_MAX_CHARS) return null;
  return normalized;
}

function normalizeSourceText(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.normalize("NFKC").replace(/\r\n?/g, "\n").trim();
  return normalized || null;
}

function normalizeForComparison(value: string) {
  return value
    .normalize("NFKC")
    .replace(/\r\n?/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLocaleLowerCase();
}

function sourceNeedsNaturalLanguageTranslation(source: string) {
  const withoutUrls = source.replace(/https?:\/\/\S+/gi, " ").trim();
  const words = withoutUrls.match(/[A-Za-z]+(?:['’][A-Za-z]+)?/g) ?? [];
  const letters = (withoutUrls.match(/[A-Za-z]/g) ?? []).length;

  // Keep names, URLs, numbers, emoji, and short product labels from becoming
  // permanent repair candidates just because they have no CJK characters.
  return words.length >= 3 || (words.length >= 2 && letters >= 14 && /[.!?]/.test(withoutUrls));
}

function hasExpectedLocaleScript(value: string, locale: TiboTranslationLocale) {
  return locale === "ja"
    ? /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(value)
    : /[\u3400-\u9fff\uf900-\ufaff]/.test(value);
}

export function validateTiboTranslation(
  sourceText: unknown,
  targetText: unknown,
  locale: TiboTranslationLocale,
): TiboTranslationValidation {
  const rawTarget = typeof targetText === "string"
    ? targetText.normalize("NFKC").replace(/\r\n?/g, "\n").trim()
    : null;
  if (!rawTarget) {
    return { valid: false, normalized: null, reason: "missing" };
  }
  if (rawTarget.length > TIBO_TRANSLATION_MAX_CHARS) {
    return { valid: false, normalized: null, reason: "too_long" };
  }
  const normalized = normalizeTiboTranslationValue(targetText);
  if (!normalized) {
    return { valid: false, normalized: null, reason: "missing" };
  }

  const source = normalizeSourceText(sourceText);
  if (!source || !sourceNeedsNaturalLanguageTranslation(source)) {
    return { valid: true, normalized, reason: "valid" };
  }

  if (normalizeForComparison(source) === normalizeForComparison(normalized)) {
    return { valid: false, normalized, reason: "same_as_source" };
  }
  if (!hasExpectedLocaleScript(normalized, locale)) {
    return { valid: false, normalized, reason: "missing_locale_script" };
  }

  return { valid: true, normalized, reason: "valid" };
}

export function isTiboTranslationValid(
  sourceText: unknown,
  targetText: unknown,
  locale: TiboTranslationLocale,
) {
  return validateTiboTranslation(sourceText, targetText, locale).valid;
}
