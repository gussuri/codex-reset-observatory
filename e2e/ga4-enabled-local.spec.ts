import { expect, test } from "@playwright/test";

declare global {
  interface Window {
    __gtagCalls?: unknown[][];
  }
}

const FAKE_GA4_MEASUREMENT_ID = "G-TEST123456";

test("valid local GA4 ID initializes once and stays safe when Google script loading is blocked", async ({ page }) => {
  test.skip(
    process.env.NEXT_PUBLIC_GA_MEASUREMENT_ID !== FAKE_GA4_MEASUREMENT_ID,
    "Run only against the local dev server built with the fake G-TEST123456 ID.",
  );

  const tagScriptRequests: string[] = [];
  const analyticsCollectionRequests: string[] = [];
  const browserTagRequests: string[] = [];
  const browserTagRequestFailures: string[] = [];
  page.on("request", (request) => {
    if (request.url().includes("googletagmanager.com")) browserTagRequests.push(request.url());
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("googletagmanager.com")) {
      browserTagRequestFailures.push(`${request.url()} (${request.failure()?.errorText ?? "unknown"})`);
    }
  });

  await page.route("**/*", async (route) => {
    const url = route.request().url();
    if (url.startsWith("https://www.googletagmanager.com/")) {
      tagScriptRequests.push(url);
      await route.abort();
      return;
    }
    if (/^https:\/\/(?:www\.|region1\.)?google-analytics\.com\//.test(url)) {
      analyticsCollectionRequests.push(url);
      await route.abort();
      return;
    }
    if (url === "https://github.com/sponsors/gussuri") {
      await route.fulfill({ status: 200, contentType: "text/html", body: "<title>Sponsors test</title>" });
      return;
    }
    await route.continue();
  });
  await page.addInitScript(() => {
    window.__gtagCalls = [];
    window.gtag = (...args: unknown[]) => {
      window.__gtagCalls?.push(args);
    };
  });

  await page.goto("/en?private=should-not-be-sent#private-fragment");
  await page.waitForFunction(() => window.__gtagCalls?.some((call) => call[0] === "config"));

  const tagCalls = await page.evaluate(() => window.__gtagCalls ?? []);
  const configCalls = tagCalls.filter((call) => call[0] === "config");
  expect(configCalls).toHaveLength(1);
  expect(configCalls[0]).toEqual([
    "config",
    FAKE_GA4_MEASUREMENT_ID,
    {
      allow_google_signals: false,
      allow_ad_personalization_signals: false,
      page_location: "http://127.0.0.1:3000/en",
    },
  ]);
  await page.waitForTimeout(1000);
  const scriptDiagnostics = await page.evaluate(() =>
    Array.from(document.scripts, (script) => ({ src: script.src, strategy: script.getAttribute("data-nscript") }))
      .filter((script) => script.src.includes("googletagmanager.com")),
  );
  expect(tagScriptRequests, JSON.stringify({ browserTagRequests, browserTagRequestFailures, scriptDiagnostics })).toEqual([
    `https://www.googletagmanager.com/gtag/js?id=${FAKE_GA4_MEASUREMENT_ID}`,
  ]);

  const sponsorLink = page.getByRole("link", { name: "Support on GitHub Sponsors", exact: true });
  const popupPromise = page.waitForEvent("popup");
  await sponsorLink.click();
  const popup = await popupPromise;
  await expect(popup).toHaveURL("https://github.com/sponsors/gussuri");
  await popup.close();

  const sponsorEvents = await page.evaluate(() =>
    (window.__gtagCalls ?? []).filter((call) => call[0] === "event" && call[1] === "sponsor_click"),
  );
  expect(sponsorEvents).toEqual([
    ["event", "sponsor_click", { placement: "panel", locale: "en", page_type: "home" }],
  ]);
  expect(analyticsCollectionRequests).toEqual([]);
});
