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
    panelTitle: "サイト運営について",
    panelBody: "本サイトの開発・運営は、GitHub Sponsorsから任意にご支援いただけます。単発・月額のどちらも選べます。",
    link: "GitHub Sponsors",
    footer: "運営を支援",
  },
  en: {
    path: "/en",
    panelTitle: "Site support",
    panelBody: "You may support the development and operation of this site through GitHub Sponsors, either once or monthly.",
    link: "GitHub Sponsors",
    footer: "Support this project",
  },
  zh: {
    path: "/zh",
    panelTitle: "关于本站运营",
    panelBody: "您可以通过 GitHub Sponsors 自愿支持本站的开发和运营，单次或按月均可。",
    link: "GitHub Sponsors",
    footer: "支持本站",
  },
} as const;

const localeAbout = {
  ja: {
    path: "/about",
    heading: "サイト運営について",
    body: "GitHub Sponsorsから単発・月額の任意のご支援を受け付けています。支援の有無で予測や閲覧できる情報は変わりません。",
  },
  en: {
    path: "/en/about",
    heading: "Site support",
    body: "Optional one-time and monthly support is available through GitHub Sponsors. Support does not affect forecasts or access to information.",
  },
  zh: {
    path: "/zh/about",
    heading: "关于本站运营",
    body: "您可以通过 GitHub Sponsors 选择单次或按月自愿支持。是否支持不会影响预测结果或可查看的信息。",
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

test("home support link is localized, restrained, and fits mobile and desktop", async ({ page }) => {
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
  await page.evaluate(() => {
    delete window.gtag;
  });
  await expectSponsorPopup(page, page.getByRole("link", { name: localeHome.ja.footer, exact: true }));

  await page.goto("/zh/faq");
  await expectSponsorPopup(page, page.getByRole("link", { name: localeHome.zh.footer, exact: true }));
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "footer", locale: "zh", page_type: "faq" }],
  ]);
  await expectNoBrowserErrors(browserErrors);
});
