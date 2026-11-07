import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Locator, type Page } from "@playwright/test";

declare global {
  interface Window {
    __sponsorEvents?: unknown[][];
  }
}

const localeHome = {
  ja: {
    path: "/",
    panelTitle: "無料公開の継続を応援してください",
    panelBody: "リセット情報の収集・履歴の整理・予測の改善を続けるため、GitHub Sponsorsでの支援を募集しています。単発・月額を問わず、少額からのご支援がサーバー維持や開発・運営の支えになります。",
    link: "GitHub Sponsorsで支援する",
    footer: "運営を支援",
  },
  en: {
    path: "/en",
    panelTitle: "Help support the work behind this site",
    panelBody: "Voluntary support through GitHub Sponsors helps sustain the work of collecting reset information, organizing history, and improving forecasts. One-time or monthly support at any amount helps cover hosting, development, and operation.",
    link: "Support on GitHub Sponsors",
    footer: "Support this project",
  },
  zh: {
    path: "/zh",
    panelTitle: "欢迎支持本站持续运营",
    panelBody: "我们通过 GitHub Sponsors 接受自愿支持，以便继续收集重置信息、整理历史记录并改进预测。无论是单次还是按月小额支持，都能帮助分担服务器与开发运营成本。",
    link: "在 GitHub Sponsors 上支持",
    footer: "支持本站",
  },
} as const;

const localeAbout = {
  ja: {
    path: "/about",
    heading: "サイト運営への任意の支援",
    body: "本サイトは個人で開発・運営しています。リセット情報の収集・履歴の整理・予測の改善を続けるため、GitHub Sponsorsで単発・月額の任意の支援を募集しています。支援の有無によって予測や閲覧できる情報が変わることはありません。",
  },
  en: {
    path: "/en/about",
    heading: "Voluntary support for this site",
    body: "This site is developed and operated independently. Voluntary one-time or monthly support through GitHub Sponsors helps continue collecting reset information, organizing history, and improving forecasts. Sponsorship does not affect forecasts or access to information.",
  },
  zh: {
    path: "/zh/about",
    heading: "自愿支持本站运营",
    body: "本站由个人独立开发和运营。我们通过 GitHub Sponsors 接受单次或按月的自愿支持，以便继续收集重置信息、整理历史记录并改进预测。是否支持不会影响预测结果或可查看的信息。",
  },
} as const;

type BrowserErrors = {
  pageErrors: string[];
  consoleErrors: string[];
};

function captureBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = { pageErrors: [], consoleErrors: [] };
  page.on("pageerror", (error) => errors.pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.consoleErrors.push(message.text());
  });
  return errors;
}

async function expectNoBrowserErrors(errors: BrowserErrors) {
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(errors.pageErrors, "uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "browser console errors").toEqual([]);
}

async function prepareSponsorPage(page: Page) {
  const browserErrors = captureBrowserErrors(page);
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.route("**/_vercel/speed-insights/script.js", (route) =>
    route.fulfill({ status: 200, contentType: "application/javascript", body: "" }),
  );
  await page.route("**/api/reset-marker", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ schemaVersion: "reset-marker-v1", marker: null, resetAt: null }),
    }),
  );
  await page.route("https://github.com/sponsors/**", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: "<title>Sponsors test</title>" }),
  );
  await page.route("https://www.googletagmanager.com/**", (route) => route.abort());
  await page.addInitScript(() => {
    window.__sponsorEvents = [];
    window.gtag = (...args: unknown[]) => {
      window.__sponsorEvents?.push(args);
    };
  });
  return browserErrors;
}

async function expectSponsorPopup(
  page: Page,
  link: Locator,
  expectedUrl = "https://github.com/sponsors/gussuri",
) {
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL(expectedUrl);
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
}

async function expectHomeSponsorPanelPlacement(page: Page) {
  const placement = await page.evaluate(() => {
    const panel = document.querySelector('section[aria-labelledby="sponsor-support-title"]');
    const guide = document.querySelector('section[aria-labelledby="observation-guide-title"]');
    const explanation = document.querySelector('section[aria-labelledby="homepage-explanation-title"]');
    const footer = document.querySelector("main > div > footer");

    return {
      panelImmediatelyBeforeGuide: panel?.nextElementSibling === guide,
      guideImmediatelyBeforeExplanation: guide?.nextElementSibling === explanation,
      explanationImmediatelyBeforeFooter: explanation?.nextElementSibling === footer,
      panelCount: document.querySelectorAll('section[aria-labelledby="sponsor-support-title"]').length,
    };
  });

  expect(placement).toEqual({
    panelImmediatelyBeforeGuide: true,
    guideImmediatelyBeforeExplanation: true,
    explanationImmediatelyBeforeFooter: true,
    panelCount: 1,
  });
}

async function expectFooterSponsorTextAligned(page: Page, sponsorLabel: string) {
  const sponsor = page.getByRole("link", { name: sponsorLabel, exact: true });
  const alignment = await sponsor.evaluate((element) => {
    const container = element.parentElement;
    const sponsorBox = element.getBoundingClientRect();

    const getTextCenter = (anchor: Element) => {
      const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
      let firstTop = Number.POSITIVE_INFINITY;
      let lastBottom = Number.NEGATIVE_INFINITY;

      while (walker.nextNode()) {
        const textNode = walker.currentNode;
        if (!textNode.textContent?.trim()) continue;
        const range = document.createRange();
        range.selectNodeContents(textNode);
        for (const rect of Array.from(range.getClientRects())) {
          firstTop = Math.min(firstTop, rect.top);
          lastBottom = Math.max(lastBottom, rect.bottom);
        }
      }

      return (firstTop + lastBottom) / 2;
    };

    const peers = container
      ? Array.from(container.querySelectorAll(":scope > a")).filter((peer) => {
          if (peer === element) return false;
          const peerBox = peer.getBoundingClientRect();
          return peerBox.top < sponsorBox.bottom && peerBox.bottom > sponsorBox.top;
        })
      : [];

    return {
      alignItems: container ? getComputedStyle(container).alignItems : "missing",
      sponsorCenter: getTextCenter(element),
      peerCenters: peers.map(getTextCenter),
    };
  });

  expect(alignment.alignItems).toBe("center");
  expect(alignment.peerCenters.length).toBeGreaterThan(0);
  for (const peerCenter of alignment.peerCenters) {
    expect(Math.abs(alignment.sponsorCenter - peerCenter)).toBeLessThanOrEqual(1.5);
  }
}

test("home support panel follows the explanation and footer links align across locales", async ({ page }) => {
  const browserErrors = await prepareSponsorPage(page);

  const screenshotDirectory = process.env.SPONSOR_SCREENSHOT_DIR;
  if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true });

  for (const [locale, copy] of Object.entries(localeHome) as Array<[
    keyof typeof localeHome,
    (typeof localeHome)[keyof typeof localeHome],
  ]>) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(copy.path);
    const siteHeader = page.locator("main > div > header");
    const panel = page.getByRole("region", { name: copy.panelTitle, exact: true });
    const panelLink = panel.getByRole("link", { name: copy.link, exact: true });
    await expect(siteHeader.locator('a[href^="https://github.com/sponsors/"]')).toHaveCount(0);
    await expect(panel).toBeVisible();
    await expect(panel.getByText(copy.panelBody, { exact: true })).toBeVisible();
    await expect(panelLink).toHaveAttribute("href", "https://github.com/sponsors/gussuri");
    await expect(panelLink).toHaveAttribute("target", "_blank");
    await expect(panelLink).toHaveAttribute("rel", "noopener noreferrer");
    await expect(panel.getByRole("link")).toHaveCount(1);
    const footerLink = page.getByRole("link", { name: copy.footer, exact: true });
    await expect(footerLink).toBeAttached();
    const [sponsorStyle, adjacentStyle] = await Promise.all([
      footerLink.evaluate((element) => ({
        color: getComputedStyle(element).color,
        fontWeight: getComputedStyle(element).fontWeight,
      })),
      page.locator("footer nav a").first().evaluate((element) => ({
        color: getComputedStyle(element).color,
        fontWeight: getComputedStyle(element).fontWeight,
      })),
    ]);
    expect(sponsorStyle).toEqual(adjacentStyle);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${locale} 320px layout has no horizontal overflow`,
    ).toBe(true);

    await page.setViewportSize({ width: 375, height: 844 });
    await expectHomeSponsorPanelPlacement(page);
    await expectFooterSponsorTextAligned(page, copy.footer);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${locale} 375px layout has no horizontal overflow`,
    ).toBe(true);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, `home-${locale}-375.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    await expect(
      page.locator("main > div > header").locator('a[href^="https://github.com/sponsors/"]'),
    ).toHaveCount(0);
    await expect(page.getByRole("region", { name: copy.panelTitle, exact: true })).toBeVisible();
    await expectHomeSponsorPanelPlacement(page);
    await expectFooterSponsorTextAligned(page, copy.footer);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${locale} desktop layout has no horizontal overflow`,
    ).toBe(true);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, `home-${locale}-desktop.png`), fullPage: true });
    }
    await expect(page.locator('script[src^="https://www.googletagmanager.com/gtag/js"]')).toHaveCount(0);
  }
  await expectNoBrowserErrors(browserErrors);
});

test("About support and privacy information fit each locale", async ({ page }) => {
  const browserErrors = await prepareSponsorPage(page);
  const screenshotDirectory = process.env.SPONSOR_SCREENSHOT_DIR;

  for (const [locale, copy] of Object.entries(localeAbout) as Array<[
    keyof typeof localeAbout,
    (typeof localeAbout)[keyof typeof localeAbout],
  ]>) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(copy.path);
    const supportSection = page.getByRole("region", { name: copy.heading, exact: true });
    const sponsorLink = supportSection.getByRole("link", { name: localeHome[locale].link, exact: true });
    await expect(supportSection).toBeVisible();
    await expect(supportSection.getByText(copy.body, { exact: true })).toBeVisible();
    await expect(sponsorLink).toHaveAttribute("href", "https://github.com/sponsors/gussuri");
    await expect(sponsorLink).toHaveAttribute("target", "_blank");
    await expect(sponsorLink).toHaveAttribute("rel", "noopener noreferrer");
    await expect(supportSection.getByRole("link")).toHaveCount(4);
    await expect(page.getByRole("link", { name: /Google uses information|サイト・アプリ情報の利用|来自网站和应用的信息/ })).toHaveAttribute(
      "href",
      /https:\/\/policies\.google\.com\/technologies\/partner-sites\?hl=/,
    );
    await expect(page.getByRole("link", { name: /Privacy Policy|プライバシー ポリシー|隐私权政策/ })).toHaveAttribute(
      "href",
      /https:\/\/policies\.google\.com\/privacy\?hl=/,
    );
    await expect(page.getByRole("link", { name: /opt-out|オプトアウト|退出浏览器插件/ })).toHaveAttribute(
      "href",
      /https:\/\/support\.google\.com\/analytics\/answer\/181881\?hl=/,
    );
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${locale} About page has no horizontal overflow at 320px`,
    ).toBe(true);

    await page.setViewportSize({ width: 375, height: 844 });
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${locale} About page has no horizontal overflow at 375px`,
    ).toBe(true);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, `about-${locale}-375.png`), fullPage: true });
    }

    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.reload();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
      `${locale} About page has no horizontal overflow on desktop`,
    ).toBe(true);
    if (screenshotDirectory) {
      await page.screenshot({ path: join(screenshotDirectory, `about-${locale}-desktop.png`), fullPage: true });
    }
  }

  await expectNoBrowserErrors(browserErrors);
});

test("sponsor links emit one low-cardinality event and preserve outbound navigation", async ({ page }) => {
  const browserErrors = await prepareSponsorPage(page);
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/");

  const siteHeader = page.locator("main > div > header");
  await expect(siteHeader.locator('a[href^="https://github.com/sponsors/"]')).toHaveCount(0);
  const panel = page.getByRole("region", { name: localeHome.ja.panelTitle, exact: true });
  await expect(panel).toBeVisible();
  const panelLink = panel.getByRole("link", { name: localeHome.ja.link, exact: true });
  await panelLink.focus();
  const keyboardPopup = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const openedFromKeyboard = await keyboardPopup;
  await expect(openedFromKeyboard).toHaveURL("https://github.com/sponsors/gussuri");
  await openedFromKeyboard.close();
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "panel", locale: "ja", page_type: "home" }],
  ]);

  await expectSponsorPopup(page, panelLink);
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "panel", locale: "ja", page_type: "home" }],
    ["event", "sponsor_click", { placement: "panel", locale: "ja", page_type: "home" }],
  ]);

  const footerLink = page.getByRole("link", { name: localeHome.ja.footer, exact: true });
  await footerLink.scrollIntoViewIfNeeded();
  await expectSponsorPopup(page, footerLink);
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "panel", locale: "ja", page_type: "home" }],
    ["event", "sponsor_click", { placement: "panel", locale: "ja", page_type: "home" }],
    ["event", "sponsor_click", { placement: "footer", locale: "ja", page_type: "home" }],
  ]);

  await page.goto("/en/about");
  await page.evaluate(() => {
    window.gtag = () => {
      throw new Error("analytics blocked");
    };
  });
  const aboutSponsor = page
    .getByRole("region", { name: localeAbout.en.heading, exact: true })
    .getByRole("link", { name: localeHome.en.link, exact: true });
  await expectSponsorPopup(page, aboutSponsor);

  await page.goto("/history");
  await expectFooterSponsorTextAligned(page, localeHome.ja.footer);
  await page.evaluate(() => {
    delete window.gtag;
  });
  await expectSponsorPopup(page, page.getByRole("link", { name: localeHome.ja.footer, exact: true }));

  await page.goto("/zh/faq");
  await expectFooterSponsorTextAligned(page, localeHome.zh.footer);
  await expectSponsorPopup(page, page.getByRole("link", { name: localeHome.zh.footer, exact: true }));
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "footer", locale: "zh", page_type: "faq" }],
  ]);
  await expectNoBrowserErrors(browserErrors);
});
