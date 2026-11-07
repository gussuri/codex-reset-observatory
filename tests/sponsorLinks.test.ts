import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { GITHUB_SPONSORS_URL } from "../lib/sponsorAnalytics";
import { translateUI } from "../lib/radar/i18n";

const root = process.cwd();

const expectedSupportCopy = {
  ja: {
    title: "無料公開の継続を応援してください",
    body: "リセット情報の収集・履歴の整理・予測の改善を続けるため、GitHub Sponsorsでの支援を募集しています。単発・月額を問わず、少額からのご支援がサーバー維持や開発・運営の支えになります。",
    link: "GitHub Sponsorsで支援する",
    aboutTitle: "サイト運営への任意の支援",
    aboutBody: "本サイトは個人で開発・運営しています。リセット情報の収集・履歴の整理・予測の改善を続けるため、GitHub Sponsorsで単発・月額の任意の支援を募集しています。支援の有無によって予測や閲覧できる情報が変わることはありません。",
  },
  en: {
    title: "Help support the work behind this site",
    body: "Voluntary support through GitHub Sponsors helps sustain the work of collecting reset information, organizing history, and improving forecasts. One-time or monthly support at any amount helps cover hosting, development, and operation.",
    link: "Support on GitHub Sponsors",
    aboutTitle: "Voluntary support for this site",
    aboutBody: "This site is developed and operated independently. Voluntary one-time or monthly support through GitHub Sponsors helps continue collecting reset information, organizing history, and improving forecasts. Sponsorship does not affect forecasts or access to information.",
  },
  zh: {
    title: "欢迎支持本站持续运营",
    body: "我们通过 GitHub Sponsors 接受自愿支持，以便继续收集重置信息、整理历史记录并改进预测。无论是单次还是按月小额支持，都能帮助分担服务器与开发运营成本。",
    link: "在 GitHub Sponsors 上支持",
    aboutTitle: "自愿支持本站运营",
    aboutBody: "本站由个人独立开发和运营。我们通过 GitHub Sponsors 接受单次或按月的自愿支持，以便继续收集重置信息、整理历史记录并改进预测。是否支持不会影响预测结果或可查看的信息。",
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

  const sponsorPanelIndex = home.indexOf("<SponsorSupportPanel locale={locale} />");
  const observationGuideIndex = home.indexOf("<ObservationGuide locale={locale} />");
  assert.ok(sponsorPanelIndex !== -1, "SponsorSupportPanel should be present in RadarDashboard");
  assert.ok(observationGuideIndex !== -1, "ObservationGuide should be present in RadarDashboard");
  assert.ok(
    sponsorPanelIndex < observationGuideIndex,
    "SponsorSupportPanel must appear before ObservationGuide in RadarDashboard",
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
