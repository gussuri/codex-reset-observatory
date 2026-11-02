import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GITHUB_SPONSORS_URL } from "../lib/sponsorAnalytics";
import { translateUI } from "../lib/radar/i18n";

const root = process.cwd();

test("sponsor links use the fixed destination and safe native outbound navigation", () => {
  const source = readFileSync(join(root, "components/SponsorLink.tsx"), "utf8");

  assert.match(source, /href={GITHUB_SPONSORS_URL}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /onClick=\{\(\) => trackSponsorClick\(/);
  assert.doesNotMatch(source, /preventDefault|window\.location/);
  assert.equal(GITHUB_SPONSORS_URL, "https://github.com/sponsors/gussuri");
});

test("support copy is complete and natural in every supported locale", () => {
  const expectedLabels = {
    ja: "GitHub Sponsorsで支援する",
    en: "Support on GitHub Sponsors",
    zh: "在 GitHub Sponsors 上支持",
  } as const;

  for (const locale of ["ja", "en", "zh"] as const) {
    assert.equal(translateUI("sponsorLink", locale), expectedLabels[locale]);
    for (const key of [
      "sponsorHeader",
      "sponsorPanelTitle",
      "sponsorPanelBody",
      "sponsorFooter",
      "aboutSupportHeading",
      "aboutSupportBody",
      "analyticsMeasurementNote",
      "googleSitesAndAppsInfo",
      "googlePrivacyPolicy",
      "googleAnalyticsOptOut",
    ]) {
      assert.notEqual(translateUI(key, locale), key, `${key} is missing in ${locale}`);
    }
  }
});

test("home, history, FAQ, and About include the requested sponsor placements", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const home = read("components/RadarDashboard.tsx");
  const supportPanel = read("components/SponsorSupportPanel.tsx");
  const history = read("components/HistoryView.tsx");
  const faq = read("components/FaqView.tsx");
  const about = read("components/AboutView.tsx");

  assert.ok(/pageType="home"[\s\S]*?placement="header"/.test(home));
  assert.ok(/pageType="home"[\s\S]*?placement="panel"/.test(supportPanel));
  assert.ok(/pageType="home"[\s\S]*?placement="footer"/.test(home));
  assert.ok(/pageType="history"[\s\S]*?placement="footer"/.test(history));
  assert.ok(/pageType="faq"[\s\S]*?placement="footer"/.test(faq));
  assert.ok(/pageType="about"[\s\S]*?placement="about"/.test(about));
  assert.ok(/support\.google\.com\/analytics\/answer\/181881/.test(about));
  assert.ok(/policies\.google\.com\/privacy/.test(about));
});

test("the original repository development link remains separate from Sponsors", () => {
  const developerLink = readFileSync(join(root, "components/DeveloperLink.tsx"), "utf8");

  assert.match(developerLink, /https:\/\/github\.com\/gussuri\/codex-reset-observatory/);
  assert.doesNotMatch(developerLink, /github\.com\/sponsors/);
});
