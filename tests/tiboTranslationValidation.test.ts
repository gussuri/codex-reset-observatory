import assert from "node:assert/strict";
import test from "node:test";

import {
  isTiboTranslationValid,
  validateTiboTranslation,
} from "../lib/radar/tiboTranslationValidation";

test("rejects a natural-language source copied into both locale translations", () => {
  const source = "OK fine. But it’s also still coming in Tuesday";

  assert.equal(isTiboTranslationValid(source, source, "ja"), false);
  assert.equal(isTiboTranslationValid(source, source, "zh"), false);
});

test("rejects source copies that differ only by whitespace and line endings", () => {
  const result = validateTiboTranslation(
    "A reset is coming tomorrow.",
    "  A   reset is coming tomorrow.\r\n",
    "ja",
  );

  assert.equal(result.valid, false);
  assert.equal(result.reason, "same_as_source");
});

test("accepts translations with the expected Japanese and Han scripts", () => {
  assert.equal(
    isTiboTranslationValid("A reset is coming tomorrow.", "明日、リセットが実施されます。", "ja"),
    true,
  );
  assert.equal(
    isTiboTranslationValid("A reset is coming tomorrow.", "明天会进行重置。", "zh"),
    true,
  );
});

test("does not reject short product names, URLs, numbers, or emoji as false translations", () => {
  assert.equal(isTiboTranslationValid("GPT-6 Astra", "GPT-6 Astra", "ja"), true);
  assert.equal(isTiboTranslationValid("https://example.com", "https://example.com", "zh"), true);
  assert.equal(isTiboTranslationValid("42 🎉", "42 🎉", "ja"), true);
});
