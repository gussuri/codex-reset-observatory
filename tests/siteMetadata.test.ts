import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Metadata } from "next";
import { fileURLToPath } from "node:url";

import { RadarDashboard } from "../components/RadarDashboard";
import { getLocalRadarData } from "../lib/radar";
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
import { metadata as jaHomeMetadata } from "../app/page";
import { metadata as enHomeMetadata } from "../app/en/page";
import { metadata as zhHomeMetadata } from "../app/zh/page";
import { metadata as jaAboutMetadata } from "../app/about/page";
import { metadata as enAboutMetadata } from "../app/en/about/page";
import { metadata as zhAboutMetadata } from "../app/zh/about/page";
import { metadata as jaFaqMetadata } from "../app/faq/page";
import { metadata as enFaqMetadata } from "../app/en/faq/page";
import { metadata as zhFaqMetadata } from "../app/zh/faq/page";
import { metadata as jaHistoryMetadata } from "../app/history/page";
import { metadata as enHistoryMetadata } from "../app/en/history/page";
import { metadata as zhHistoryMetadata } from "../app/zh/history/page";

(globalThis as typeof globalThis & { React: typeof React }).React = React;

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function titleFrom(metadata: Metadata): string {
  if (typeof metadata.title === "string") {
    return metadata.title;
  }

  return metadata.title?.absolute ?? metadata.title?.default ?? "";
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
    assert.strictEqual(openGraph.images?.[0]?.url, SITE_OG_IMAGE_URL);

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

  const appSource = readFileSync(join(root, "app/layout.tsx"), "utf8");
  assert.strictEqual((appSource.match(/getSiteJsonLd\(/g) ?? []).length, 1);
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

test("Japanese home HTML exposes the English formal brand and Japanese supporting name", () => {
  const html = renderToStaticMarkup(
    React.createElement(RadarDashboard, {
      initialData: getLocalRadarData({}),
      locale: "ja",
    }),
  );

  assert.match(html, /<h1[^>]*>Codex Reset Observatory<\/h1>/);
  assert.match(html, /Codexリセット観測所/);
});

test("all home locales expose the same formal brand in the main heading", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const html = renderToStaticMarkup(
      React.createElement(RadarDashboard, {
        initialData: getLocalRadarData({}),
        locale,
      }),
    );

    assert.match(html, /<h1[^>]*>Codex Reset Observatory<\/h1>/, locale);
  }
});

test("root metadata no longer defines a meta keywords list or duplicate WebSite JSON-LD", () => {
  const layoutSource = readFileSync(join(root, "app/layout.tsx"), "utf8");

  assert.match(layoutSource, /applicationName:\s*SITE_NAME/);
  assert.doesNotMatch(layoutSource, /keywords\s*:/);
  assert.strictEqual((layoutSource.match(/application\/ld\+json/g) ?? []).length, 1);
});
