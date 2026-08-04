import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import { fileURLToPath } from "node:url";

import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData } from "../lib/radar";
import { toPublicRadarSnapshot } from "../lib/radar/publicDto";
import {
  getSiteJsonLd,
  HOME_DESCRIPTION_EN,
  HOME_DESCRIPTION_JA,
  HOME_DESCRIPTION_ZH,
  HOME_TITLE_EN,
  HOME_TITLE_JA,
  HOME_TITLE_ZH,
  SITE_NAME,
  SITE_NAME_JA,
  SITE_OG_IMAGE_URL,
  SITE_URL,
  siteUrl,
} from "../lib/siteMetadata";
import { metadata as jaHomeMetadata } from "../app/(ja)/page";
import { metadata as enHomeMetadata } from "../app/(en)/en/page";
import { metadata as zhHomeMetadata } from "../app/(zh)/zh/page";
import { metadata as jaAboutMetadata } from "../app/(ja)/about/page";
import { metadata as enAboutMetadata } from "../app/(en)/en/about/page";
import { metadata as zhAboutMetadata } from "../app/(zh)/zh/about/page";
import { metadata as jaFaqMetadata } from "../app/(ja)/faq/page";
import { metadata as enFaqMetadata } from "../app/(en)/en/faq/page";
import { metadata as zhFaqMetadata } from "../app/(zh)/zh/faq/page";
import { metadata as jaHistoryMetadata } from "../app/(ja)/history/page";
import { metadata as enHistoryMetadata } from "../app/(en)/en/history/page";
import { metadata as zhHistoryMetadata } from "../app/(zh)/zh/history/page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function titleFrom(metadata: Metadata): string {
  if (typeof metadata.title === "string") {
    return metadata.title;
  }

  const title = metadata.title;
  if (!title) return "";
  return "absolute" in title ? title.absolute ?? "" : title.default ?? "";
}

function openGraphFrom(metadata: Metadata) {
  assert.ok(metadata.openGraph && !Array.isArray(metadata.openGraph));
  return metadata.openGraph;
}

test("home metadata uses the unified brand and requested localized titles/descriptions", () => {
  const homeCases = [
    [jaHomeMetadata, HOME_TITLE_JA, HOME_DESCRIPTION_JA, "ja"],
    [enHomeMetadata, HOME_TITLE_EN, HOME_DESCRIPTION_EN, "en"],
    [zhHomeMetadata, HOME_TITLE_ZH, HOME_DESCRIPTION_ZH, "zh"],
  ] as const;

  for (const [metadata, title, description, path] of homeCases) {
    assert.strictEqual(metadata.applicationName, SITE_NAME);
    assert.strictEqual(titleFrom(metadata), title);
    assert.strictEqual(metadata.description, description);

    const openGraph = openGraphFrom(metadata);
    assert.strictEqual(openGraph.siteName, SITE_NAME);
    assert.strictEqual(openGraph.title, title);
    assert.strictEqual(openGraph.description, description);
    assert.strictEqual(openGraph.url, siteUrl(path === "ja" ? "/" : "/" + path));
    const firstImage = Array.isArray(openGraph.images)
      ? openGraph.images[0]
      : openGraph.images;
    const firstImageUrl =
      typeof firstImage === "string"
        ? firstImage
        : firstImage instanceof URL
          ? firstImage.toString()
          : firstImage?.url;
    assert.strictEqual(firstImageUrl, SITE_OG_IMAGE_URL);

    assert.strictEqual(metadata.twitter?.title, title);
    assert.strictEqual(metadata.twitter?.description, description);
    assert.deepStrictEqual(metadata.twitter?.images, [SITE_OG_IMAGE_URL]);
  }
});

test("WebSite JSON-LD uses one formal name and only the Japanese alternate name", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const jsonLd = getSiteJsonLd(locale);

    assert.strictEqual(jsonLd.name, SITE_NAME);
    assert.deepStrictEqual(jsonLd.alternateName, [SITE_NAME_JA]);
    assert.strictEqual(jsonLd.url, siteUrl("/"));
    assert.strictEqual(jsonLd["@id"], SITE_URL + "/#website");
    assert.doesNotMatch(JSON.stringify(jsonLd.alternateName), /vercel|\.app/i);
  }

  const jsonLdSource = readFileSync(join(root, "components/SiteJsonLd.tsx"), "utf8");
  assert.strictEqual((jsonLdSource.match(/getSiteJsonLd\(/g) ?? []).length, 1);

  for (const [layout, lang] of [
    ["app/(ja)/layout.tsx", "ja"],
    ["app/(en)/layout.tsx", "en"],
    ["app/(zh)/layout.tsx", "zh"],
  ] as const) {
    const source = readFileSync(join(root, layout), "utf8");
    assert.match(source, new RegExp(`<html lang="${lang}">`));
    assert.match(source, new RegExp(`<SiteJsonLd locale="${lang}"`));
    assert.doesNotMatch(source, /headers\(|x-codex-pathname/);
  }
});

test("all localized pages use the formal application name and absolute URL metadata", () => {
  const pages = [
    [jaHomeMetadata, "/"],
    [enHomeMetadata, "/en"],
    [zhHomeMetadata, "/zh"],
    [jaAboutMetadata, "/about"],
    [enAboutMetadata, "/en/about"],
    [zhAboutMetadata, "/zh/about"],
    [jaFaqMetadata, "/faq"],
    [enFaqMetadata, "/en/faq"],
    [zhFaqMetadata, "/zh/faq"],
    [jaHistoryMetadata, "/history"],
    [enHistoryMetadata, "/en/history"],
    [zhHistoryMetadata, "/zh/history"],
  ] as const;

  for (const [metadata, path] of pages) {
    assert.strictEqual(metadata.applicationName, SITE_NAME, path);
    assert.strictEqual(openGraphFrom(metadata).siteName, SITE_NAME, path);
    assert.strictEqual(openGraphFrom(metadata).url, siteUrl(path), path);
    assert.strictEqual(metadata.alternates?.canonical, siteUrl(path), path);
    assert.strictEqual("keywords" in metadata, false, path);
  }
});

test("canonical and hreflang links point to the same three localized routes", () => {
  for (const metadata of [jaHomeMetadata, enHomeMetadata, zhHomeMetadata]) {
    assert.deepStrictEqual(metadata.alternates?.languages, {
      ja: siteUrl("/"),
      en: siteUrl("/en"),
      zh: siteUrl("/zh"),
    });
  }
});

test("Japanese home HTML exposes the Japanese main brand and English supporting name", () => {
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: toPublicRadarSnapshot(getLocalRadarData({}), "ja"),
      locale: "ja",
    }),
  );

  assert.match(html, /<h1[^>]*>Codexリセット観測所<\/h1>/);
  assert.match(html, /<p[^>]*>Codex Reset Observatory<\/p>/);
});

test("all home locales use the locale-appropriate main heading and formal brand", () => {
  const expectedHeadings = {
    ja: "Codexリセット観測所",
    en: "Codex Reset Observatory",
    zh: "Codex 重置观测站",
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, {
        initialData: toPublicRadarSnapshot(getLocalRadarData({}), locale),
        locale,
      }),
    );

    assert.match(html, new RegExp(`<h1[^>]*>${expectedHeadings[locale]}<\\/h1>`), locale);
    assert.match(html, /Codex Reset Observatory/, locale);
  }
});

test("localized root layouts avoid keywords, headers, and duplicate JSON-LD", () => {
  const layoutSources = [
    "app/(ja)/layout.tsx",
    "app/(en)/layout.tsx",
    "app/(zh)/layout.tsx",
  ].map((path) => readFileSync(join(root, path), "utf8"));

  for (const layoutSource of layoutSources) {
    assert.doesNotMatch(layoutSource, /keywords\s*:/);
    assert.doesNotMatch(layoutSource, /headers\(/);
    assert.strictEqual((layoutSource.match(/application\/ld\+json/g) ?? []).length, 0);
  }

  assert.equal(existsSync(join(root, "middleware.ts")), false);
});
