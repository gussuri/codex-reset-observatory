import test from "node:test";
import assert from "node:assert/strict";
import { getDocumentLocale } from "../lib/locale";
import { getClientDocumentLocale } from "../components/DocumentLocale";

test("uses the English document locale for English routes", () => {
  assert.equal(getDocumentLocale("/en"), "en");
  assert.equal(getDocumentLocale("/en/faq"), "en");
});

test("uses the Chinese document locale for Chinese routes", () => {
  assert.equal(getDocumentLocale("/zh"), "zh");
  assert.equal(getDocumentLocale("/zh/history"), "zh");
});

test("defaults document locale to Japanese", () => {
  assert.equal(getDocumentLocale("/"), "ja");
  assert.equal(getDocumentLocale("/faq"), "ja");
});

test("maps client navigation paths to the document locale", () => {
  assert.equal(getClientDocumentLocale("/en"), "en");
  assert.equal(getClientDocumentLocale("/en/faq"), "en");
  assert.equal(getClientDocumentLocale(null), "ja");
});
