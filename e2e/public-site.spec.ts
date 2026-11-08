import { expect, test, type Page } from "@playwright/test";
import { formatDateTimeInZone } from "../components/LocalizedDateTime";

type BrowserErrors = {
  pageErrors: string[];
  consoleErrors: string[];
};

function captureBrowserErrors(page: Page): BrowserErrors {
  const errors: BrowserErrors = {
    pageErrors: [],
    consoleErrors: [],
  };

  page.on("pageerror", (error) => {
    errors.pageErrors.push(error.message);
  });
  page.on("console", (message) => {
    if (message.type() === "error") {
      errors.consoleErrors.push(message.text());
    }
  });

  return errors;
}

async function prepareLocalPage(page: Page) {
  // Vercel Analytics is optional on the local server; keep its browser script
  // from turning a missing local analytics route into a false E2E failure.
  await page.route("**/_vercel/insights/script.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );
  // Speed Insights is served by Vercel; keep the local E2E server from
  // turning its optional instrumentation script into a console error.
  await page.route("**/_vercel/speed-insights/script.js", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: "",
    }),
  );
  // The local E2E server intentionally has no Supabase credentials. Provide
  // an empty marker baseline so that this optional read does not create a
  // browser console error while the marker route itself is tested separately.
  await page.route("**/api/reset-marker", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      headers: { "cache-control": "public, max-age=0, s-maxage=60" },
      body: JSON.stringify({
        schemaVersion: "reset-marker-v1",
        marker: null,
        resetAt: null,
      }),
    }),
  );
  return captureBrowserErrors(page);
}

async function expectNoBrowserErrors(errors: BrowserErrors) {
  // Allow hydration and the first client refresh to finish before checking.
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(errors.pageErrors, "uncaught page errors").toEqual([]);
  expect(errors.consoleErrors, "browser console errors").toEqual([]);
}

test("Japanese home renders the dashboard without browser errors", async ({ page }) => {
  const errors = await prepareLocalPage(page);
  const response = await page.goto("/");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Codexリセット観測所", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("現在の状況", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^ランダムリセット/ }).first()).toBeVisible();
  await expect(page.getByText("24時間以内", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "よくある質問（FAQ）" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "この数字と観測情報の見方" })).toBeVisible();
  await expect(
    page.getByText("利用枠上限への備えと予測シグナルの読み解き方", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "予測方法と数値の見方を詳しく見る", exact: true }),
  ).toHaveAttribute("href", "/faq");
  await expect(
    page.getByRole("link", { name: "過去のリセット履歴を見る", exact: true }),
  ).toHaveAttribute("href", "/history");

  const forecastFaq = page.locator("details").filter({
    hasText: "リセット期待度とは何ですか？どのように計算されますか？",
  });
  await forecastFaq.locator("summary").click();
  await expect(forecastFaq).toHaveAttribute("open", "");
  await expect(forecastFaq.getByText(/統計的な目安です/)).toBeVisible();
  await expectNoBrowserErrors(errors);
});

test("weekly references show their expected date and time on localized home and history pages", async ({ page, request }, testInfo) => {
  const locales = [
    {
      locale: "ja",
      formatLocale: "ja-JP",
      referenceLabel: "参考日時",
      note: "直近の全体強制リセットを基準にした7日周期の共通目安です。各アカウントの利用枠回復を確認した記録ではありません。",
      home: "/",
      history: "/history",
    },
    {
      locale: "en",
      formatLocale: "en-US",
      referenceLabel: "Reference time",
      note: "This shared reference follows seven days after the latest global forced reset. It does not confirm quota recovery for any account.",
      home: "/en",
      history: "/en/history",
    },
    {
      locale: "zh",
      formatLocale: "zh-CN",
      referenceLabel: "参考时间",
      note: "此共享参考时间按最近一次全局强制重置每7天推算，不代表已确认任何账号的额度恢复。",
      home: "/zh",
      history: "/zh/history",
    },
  ] as const;
  const errors = await prepareLocalPage(page);

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 1440, height: 900 },
  ]) {
    await page.setViewportSize(viewport);

    for (const localized of locales) {
      const response = await request.get(`/api/current?locale=${localized.locale}`);
      expect(response.status()).toBe(200);
      const body = await response.json() as {
        schemaVersion: string;
        viewModel: {
          recentHistory: Array<{
            key: string;
            recordKind?: string;
            status: string;
            date?: string | null;
            resetAt?: string | null;
            resetLabel: string;
            summary?: string | null;
          }>;
        };
      };
      expect(body.schemaVersion).toBe("public-v1");
      const projected = body.viewModel.recentHistory.find(
        (item) => item.key.startsWith("weekly-regular-reference-"),
      );
      expect(projected).toMatchObject({
        recordKind: "reference",
        status: localized.referenceLabel,
        resetLabel: localized.referenceLabel,
        resetAt: null,
      });
      expect(projected?.date).toBeTruthy();
      expect(projected?.summary).toContain(localized.note);
      const referenceDate = new Date(projected!.date!).toISOString();

      for (const [pageKind, path] of [
        ["home", localized.home],
        ["history", localized.history],
      ] as const) {
        await page.goto(path);
        const time = page
          .locator(`time[datetime="${referenceDate}"]`)
          .filter({ visible: true })
          .first();
        await expect(time).toBeVisible();
        const viewerTimeZone = await page.evaluate(() =>
          Intl.DateTimeFormat().resolvedOptions().timeZone,
        );
        const expectedTime = formatDateTimeInZone(
          new Date(referenceDate),
          viewerTimeZone,
          localized.formatLocale,
        );
        await expect(time).toHaveText(expectedTime);
        const dateRowText = await time.evaluate((element) => {
          let parent = element.parentElement;
          while (parent && parent.tagName !== "P" && parent.tagName !== "DIV") {
            parent = parent.parentElement;
          }
          return parent?.textContent ?? "";
        });
        expect(dateRowText).toContain(localized.referenceLabel);
        expect(dateRowText).not.toMatch(/(?:Unknown|不明|未知|—|-)\s*$/i);

        await time.scrollIntoViewIfNeeded();
        await page.screenshot({
          path: testInfo.outputPath(`weekly-reference-${localized.locale}-${pageKind}-${viewport.width}.png`),
          animations: "disabled",
        });
      }
    }
  }

  await expectNoBrowserErrors(errors);
});

test("English home renders localized identity and dashboard labels", async ({ page }) => {
  const errors = await prepareLocalPage(page);
  const response = await page.goto("/en");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(
    page.getByRole("heading", { name: "Codex Reset Observatory", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Current status", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Random reset/ }).first()).toBeVisible();
  await expectNoBrowserErrors(errors);
});

test("Chinese home renders localized identity and dashboard labels", async ({ page }) => {
  const errors = await prepareLocalPage(page);
  const response = await page.goto("/zh");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/zh\/?$/);
  await expect(
    page.getByRole("heading", { name: "Codex 重置观测站", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("当前状况", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^随机重置/ }).first()).toBeVisible();
  await expectNoBrowserErrors(errors);
});

test("locale links switch from Japanese to English and Chinese", async ({ page }) => {
  const errors = await prepareLocalPage(page);
  await page.goto("/");

  await page
    .locator("header")
    .getByRole("link", { name: "English", exact: true })
    .click();
  await expect(page).toHaveURL(/\/en\/?$/);
  await expect(
    page.getByRole("heading", { name: "Codex Reset Observatory", exact: true }),
  ).toBeVisible();

  await page
    .locator("header")
    .getByRole("link", { name: "简体中文", exact: true })
    .click();
  await expect(page).toHaveURL(/\/zh\/?$/);
  await expect(
    page.getByRole("heading", { name: "Codex 重置观测站", exact: true }),
  ).toBeVisible();
  await expectNoBrowserErrors(errors);
});

test("local current API keeps the public contract for every locale", async ({ request }) => {
  for (const locale of ["ja", "en", "zh"] as const) {
    const response = await request.get(`/api/current?locale=${locale}`);

    expect(response.status(), `HTTP status for ${locale}`).toBe(200);
    expect(response.headers()["content-type"], `content type for ${locale}`).toContain(
      "application/json",
    );

    const body = await response.json() as Record<string, unknown>;
    for (const key of ["schemaVersion", "checkedAt", "dataHealth", "viewModel"]) {
      expect(body, `${key} for ${locale}`).toHaveProperty(key);
    }
    expect(body.schemaVersion).toBe("public-v1");
    expect(body).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
    expect(body).not.toHaveProperty("serviceRoleKey");
    expect(body).not.toHaveProperty("active_tibo_signals");
    expect(body).not.toHaveProperty("prediction_history");
  }
});
