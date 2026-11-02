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
    header: "♡ 運営を支援",
    panel: "無料公開の継続を応援してください",
    link: "GitHub Sponsorsで支援する",
    footer: "運営を支援",
  },
  en: {
    path: "/en",
    header: "♡ Support the project",
    panel: "Help support the work behind this site",
    link: "Support on GitHub Sponsors",
    footer: "Support this project",
  },
  zh: {
    path: "/zh",
    header: "♡ 支持本站运营",
    panel: "欢迎支持本站持续运营",
    link: "在 GitHub Sponsors 上支持",
    footer: "支持本站",
  },
} as const;

const localeAbout = {
  ja: { path: "/about", heading: "サイト運営への任意の支援" },
  en: { path: "/en/about", heading: "Voluntary support for this site" },
  zh: { path: "/zh/about", heading: "自愿支持本站运营" },
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
  await page.route("https://github.com/sponsors/gussuri", (route) =>
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

async function expectSponsorPopup(page: Page, link: Locator) {
  const popupPromise = page.waitForEvent("popup");
  await link.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://github.com/sponsors/gussuri");
  expect(await popup.evaluate(() => window.opener)).toBeNull();
  await popup.close();
}

test("home support CTA is localized, prominent, and fits mobile and desktop", async ({ page }) => {
  const browserErrors = await prepareSponsorPage(page);

  const screenshotDirectory = process.env.SPONSOR_SCREENSHOT_DIR;
  if (screenshotDirectory) mkdirSync(screenshotDirectory, { recursive: true });

  for (const [locale, copy] of Object.entries(localeHome) as Array<[
    keyof typeof localeHome,
    (typeof localeHome)[keyof typeof localeHome],
  ]>) {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.goto(copy.path);
    await expect(page.getByRole("link", { name: copy.header, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.panel, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.link, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: copy.footer, exact: true })).toBeAttached();
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
    await expect(page.getByRole("link", { name: copy.header, exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: copy.panel, exact: true })).toBeVisible();
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
    await expect(page.getByRole("heading", { name: copy.heading, exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: localeHome[locale].link, exact: true })).toBeVisible();
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

  const header = page.getByRole("link", { name: localeHome.ja.header, exact: true });
  await header.focus();
  const keyboardPopup = page.waitForEvent("popup");
  await page.keyboard.press("Enter");
  const openedFromKeyboard = await keyboardPopup;
  await expect(openedFromKeyboard).toHaveURL("https://github.com/sponsors/gussuri");
  await openedFromKeyboard.close();
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "header", locale: "ja", page_type: "home" }],
  ]);

  await expectSponsorPopup(page, page.getByRole("link", { name: localeHome.ja.link, exact: true }));
  expect(await page.evaluate(() => window.__sponsorEvents)).toEqual([
    ["event", "sponsor_click", { placement: "header", locale: "ja", page_type: "home" }],
    ["event", "sponsor_click", { placement: "panel", locale: "ja", page_type: "home" }],
  ]);

  const footerLink = page.getByRole("link", { name: localeHome.ja.footer, exact: true });
  await footerLink.scrollIntoViewIfNeeded();
  await expectSponsorPopup(page, footerLink);
  expect(await page.evaluate(() => window.__sponsorEvents)).toHaveLength(3);

  await page.goto("/en/about");
  await page.evaluate(() => {
    window.gtag = () => {
      throw new Error("analytics blocked");
    };
  });
  await expectSponsorPopup(page, page.getByRole("link", { name: localeHome.en.link, exact: true }));

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
