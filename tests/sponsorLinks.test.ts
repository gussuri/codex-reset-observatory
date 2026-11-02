import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GITHUB_SPONSORS_URL } from "../lib/sponsorAnalytics";
import { translateUI } from "../lib/radar/i18n";

const root = process.cwd();

const expectedSupportCopy = {
  ja: {
    title: "サイト運営について",
    body: "本サイトの開発・運営は、GitHub Sponsorsから任意にご支援いただけます。単発・月額のどちらも選べます。",
    aboutBody: "GitHub Sponsorsから単発・月額の任意のご支援を受け付けています。支援の有無で予測や閲覧できる情報は変わりません。",
  },
  en: {
    title: "Site support",
    body: "You may support the development and operation of this site through GitHub Sponsors, either once or monthly.",
    aboutBody: "Optional one-time and monthly support is available through GitHub Sponsors. Support does not affect forecasts or access to information.",
  },
  zh: {
    title: "关于本站运营",
    body: "您可以通过 GitHub Sponsors 自愿支持本站的开发和运营，单次或按月均可。",
    aboutBody: "您可以通过 GitHub Sponsors 选择单次或按月自愿支持。是否支持不会影响预测结果或可查看的信息。",
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

test("support copy is neutral, concise, and consistent in every locale", () => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const expected = expectedSupportCopy[locale];
    assert.equal(translateUI("sponsorPanelTitle", locale), expected.title);
    assert.equal(translateUI("aboutSupportHeading", locale), expected.title);
    assert.equal(translateUI("sponsorPanelBody", locale), expected.body);
    assert.equal(translateUI("aboutSupportBody", locale), expected.aboutBody);
    assert.equal(translateUI("sponsorLink", locale), "GitHub Sponsors");
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
