import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GITHUB_SPONSORS_URL } from "../lib/sponsorAnalytics";
import { translateUI } from "../lib/radar/i18n";

const root = process.cwd();

const expectedSupportCopy = {
  ja: {
    title: "サイトの応援はこちらから",
    body: "GitHubに飛びます",
    link: "GitHub Sponsorsで応援する",
    aboutTitle: "サイトの応援について",
    aboutBody: "サイトの応援は GitHub Sponsors から受け付けています（ボタンからGitHubに飛びます）。応援の有無によって予測や閲覧できる情報が変わることはありません。",
  },
  en: {
    title: "Support this site",
    body: "Opens GitHub",
    link: "Support on GitHub Sponsors",
    aboutTitle: "Supporting this site",
    aboutBody: "Support for this site is welcome via GitHub Sponsors (the button opens GitHub). Support does not affect forecasts or access to information.",
  },
  zh: {
    title: "支持本站请由此进入",
    body: "将跳转至 GitHub",
    link: "前往 GitHub Sponsors 支持",
    aboutTitle: "关于支持本站",
    aboutBody: "本站通过 GitHub Sponsors 接受自愿支持（点击按钮将跳转至 GitHub）。是否支持不会影响预测结果或可查看的信息。",
  },
} as const;

test("SponsorLink uses the one canonical destination and safe native navigation", () => {
  const source = readFileSync(join(root, "components/SponsorLink.tsx"), "utf8");

  assert.match(source, /href={GITHUB_SPONSORS_URL}/);
  assert.match(source, /target="_blank"/);
  assert.match(source, /rel="noopener noreferrer"/);
  assert.match(source, /onClick=\{\(\) => trackSponsorClick\(/);
  assert.doesNotMatch(source, /SponsorFrequency|frequency|one-time|preventDefault|window\.location/);
  assert.equal(GITHUB_SPONSORS_URL, "https://github.com/sponsors/gussuri");
});

test("support copy preserves the original purpose-focused wording in every locale", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const expected = expectedSupportCopy[locale];
    assert.equal(translateUI("sponsorPanelTitle", locale), expected.title);
    assert.equal(translateUI("aboutSupportHeading", locale), expected.aboutTitle);
    assert.equal(translateUI("sponsorPanelBody", locale), expected.body);
    assert.equal(translateUI("aboutSupportBody", locale), expected.aboutBody);
    assert.equal(translateUI("sponsorLink", locale), expected.link);
    assert.notEqual(translateUI("sponsorFooter", locale), "sponsorFooter");

    for (const key of [
      "sponsorPanelTitle",
      "sponsorPanelBody",
      "sponsorLink",
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

test("home has no header Sponsors CTA and each support section has one link", () => {
  const read = (path: string) => readFileSync(join(root, path), "utf8");
  const home = read("components/RadarDashboard.tsx");
  const supportPanel = read("components/SponsorSupportPanel.tsx");
  const history = read("components/HistoryView.tsx");
  const faq = read("components/FaqView.tsx");
  const about = read("components/AboutView.tsx");
  const sponsorLinkCount = (source: string) => (source.match(/<SponsorLink\b/g) ?? []).length;

  const recentResetEventsIndex = home.indexOf('translateUI("recentResetEvents", locale)');
  const sponsorPanelIndex = home.indexOf("<SponsorSupportPanel locale={locale} />");
  const heatmapIndex = home.indexOf("<RandomResetTimeHeatmap");
  assert.ok(recentResetEventsIndex !== -1, "recentResetEvents should be present in RadarDashboard");
  assert.ok(sponsorPanelIndex !== -1, "SponsorSupportPanel should be present in RadarDashboard");
  assert.ok(heatmapIndex !== -1, "RandomResetTimeHeatmap should be present in RadarDashboard");
  assert.ok(
    recentResetEventsIndex < sponsorPanelIndex,
    "SponsorSupportPanel must appear after recentResetEvents in RadarDashboard",
  );
  assert.ok(
    sponsorPanelIndex < heatmapIndex,
    "SponsorSupportPanel must appear before RandomResetTimeHeatmap in RadarDashboard",
  );

  assert.doesNotMatch(home, /placement="header"/);
  assert.equal(sponsorLinkCount(supportPanel), 1);
  assert.equal(sponsorLinkCount(about), 1);
  assert.match(home, /placement="footer"/);
  assert.match(history, /placement="footer"/);
  assert.match(faq, /placement="footer"/);
  assert.match(about, /support\.google\.com\/analytics\/answer\/181881/);
  assert.match(about, /policies\.google\.com\/privacy/);
  assert.match(about, /policies\.google\.com\/technologies\/partner-sites/);
});

test("the original repository development link remains separate from Sponsors", () => {
  const developerLink = readFileSync(join(root, "components/DeveloperLink.tsx"), "utf8");

  assert.match(developerLink, /https:\/\/github\.com\/gussuri\/codex-reset-observatory/);
  assert.doesNotMatch(developerLink, /github\.com\/sponsors/);
});
