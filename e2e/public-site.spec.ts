import { expect, test, type Page } from "@playwright/test";

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

test("a reset-marker snapshot refreshes history and full-history heatmap across locales and viewports", async ({ browser }) => {
  const locales = [
    {
      locale: "ja",
      path: "/",
      heatmapHeading: "過去のランダムリセット時刻",
      intervalHeading: "過去のランダムリセット間隔",
      allPeriod: "全期間",
      countLabel: "リセット件数",
      averageLabel: "平均",
      averageValue: "1.5日",
      intervalBar: /24–48時間・(\d+)件/,
    },
    {
      locale: "en",
      path: "/en",
      heatmapHeading: "Past random reset times",
      intervalHeading: "Past random reset intervals",
      allPeriod: "All time",
      countLabel: "Reset records",
      averageLabel: "Average",
      averageValue: "1.5d",
      intervalBar: /24–48h, (\d+) intervals/,
    },
    {
      locale: "zh",
      path: "/zh",
      heatmapHeading: "历史随机重置时刻分布",
      intervalHeading: "历史随机重置间隔分布",
      allPeriod: "全部记录",
      countLabel: "重置次数",
      averageLabel: "平均值",
      averageValue: "1.5天",
      intervalBar: /24–48小时，(\d+)个间隔/,
    },
  ] as const;

  for (const localeConfig of locales) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = await prepareLocalPage(page);
    await page.clock.install({ time: new Date("2026-10-01T00:00:00.000Z") });

    const baselineResponse = await page.request.get(`/api/current?locale=${localeConfig.locale}`);
    expect(baselineResponse.status()).toBe(200);
    const baseline = await baselineResponse.json() as any;
    let markerPolls = 0;
    let heatmapRefreshes = 0;
    let publishReset = false;
    let heatmapTimes: string[] = [];
    const resetAt = "2026-10-01T00:01:00.000Z";
    const resetTitle = "E2E_CONFIRMED_GLOBAL_RESET_20261001";
    const updated = {
      ...baseline,
      checkedAt: "2026-10-01T00:01:10.000Z",
      lastRandomResetAt: resetAt,
      viewModel: {
        ...baseline.viewModel,
        recentHistory: [
          {
            ...(baseline.viewModel.recentHistory[0] ?? {}),
            id: "e2e-confirmed-global-reset",
            key: "e2e-confirmed-global-reset",
            resetAt,
            recordKind: "confirmed_global",
            title: resetTitle,
          },
          ...baseline.viewModel.recentHistory,
        ],
      },
    };

    await page.route("**/api/current?**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(publishReset ? updated : baseline),
      });
    });
    await page.route("**/api/reset-marker", async (route) => {
      markerPolls += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(publishReset
          ? { schemaVersion: "reset-marker-v1", marker: "e2e-confirmed-global-reset", resetAt }
          : { schemaVersion: "reset-marker-v1", marker: baseline.lastRandomResetAt, resetAt: baseline.lastRandomResetAt }),
      });
    });
    await page.route("**/api/current/heatmap?**", async (route) => {
      heatmapRefreshes += 1;
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ eventTimes: heatmapTimes }),
      });
    });

    await page.goto(localeConfig.path);
    await expect.poll(() => markerPolls).toBe(1);
    const heatmap = page.getByRole("region", { name: localeConfig.heatmapHeading });
    await heatmap.getByRole("button", { name: localeConfig.allPeriod }).click();
    const countLabel = heatmap.getByText(new RegExp(`${localeConfig.countLabel}: n=`));
    await expect(countLabel).toBeVisible();
    const initialCountText = await countLabel.textContent();
    const initialCount = Number(initialCountText?.match(/n=(\d+)/)?.[1]);
    expect(Number.isInteger(initialCount)).toBe(true);
    expect(initialCount).toBeGreaterThan(0);
    const averageBefore = await heatmap.locator("dl").locator("div").filter({
      has: page.getByText(localeConfig.averageLabel, { exact: true }),
    }).locator("dd").textContent();

    // Use a visibly different, uniform 37-hour interval to make the aggregate
    // assertion deterministic for every starting dataset.
    heatmapTimes = Array.from({ length: initialCount + 1 }, (_, index) =>
      new Date(Date.parse(resetAt) - index * 37 * 60 * 60 * 1000).toISOString(),
    );
    publishReset = true;
    await page.clock.fastForward(5 * 60 * 1000);

    await expect.poll(() => markerPolls).toBeGreaterThan(1);
    await expect(page.getByText(resetTitle, { exact: true })).toBeVisible();
    await expect(page.locator(`time[datetime="${resetAt}"]`)).toBeVisible();
    await expect(heatmap.getByText(`${localeConfig.countLabel}: n=${initialCount + 1}`, { exact: true })).toBeVisible();
    await expect(heatmap.locator("dl").locator("div").filter({
      has: page.getByText(localeConfig.averageLabel, { exact: true }),
    }).locator("dd")).toHaveText(localeConfig.averageValue);
    expect(averageBefore).not.toBe(localeConfig.averageValue);

    const intervalBars = await heatmap.getByRole("list", { name: localeConfig.intervalHeading }).getByRole("img").all();
    const intervalCounts = await Promise.all(intervalBars.map(async (bar) => {
      const label = await bar.getAttribute("aria-label");
      const match = label?.match(localeConfig.intervalBar);
      return Number(match?.[1] ?? 0);
    }));
    expect(intervalCounts.reduce((sum, count) => sum + count, 0)).toBe(initialCount);

    const visibleTimeCharts = page.locator(`[role="list"][aria-label="${localeConfig.heatmapHeading}"]:visible`);
    await expect(visibleTimeCharts).toHaveCount(1);
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(visibleTimeCharts).toHaveCount(1);
    await expect(heatmap.getByText(`${localeConfig.countLabel}: n=${initialCount + 1}`, { exact: true })).toBeVisible();

    // A duplicate marker poll must not refetch or append the same reset again.
    const refreshesAfterReset = heatmapRefreshes;
    const pollsAfterReset = markerPolls;
    await page.clock.fastForward(5 * 60 * 1000);
    await expect.poll(() => markerPolls).toBeGreaterThan(pollsAfterReset);
    expect(heatmapRefreshes).toBe(refreshesAfterReset);
    await expect(heatmap.getByText(`${localeConfig.countLabel}: n=${initialCount + 1}`, { exact: true })).toBeVisible();
    await expectNoBrowserErrors(errors);
    await page.close();
  }
});

test("an unaligned heatmap response keeps the last valid graph while history updates", async ({ page }) => {
  const errors = await prepareLocalPage(page);
  await page.clock.install({ time: new Date("2026-10-01T00:00:00.000Z") });

  const baselineResponse = await page.request.get("/api/current?locale=ja");
  expect(baselineResponse.status()).toBe(200);
  const baseline = await baselineResponse.json() as any;
  let markerPolls = 0;
  let publishReset = false;
  const resetAt = "2026-10-01T00:01:00.000Z";
  const resetTitle = "E2E_CONFIRMED_GLOBAL_RESET_20261001";
  const updated = {
    ...baseline,
    checkedAt: "2026-10-01T00:01:10.000Z",
    lastRandomResetAt: resetAt,
    viewModel: {
      ...baseline.viewModel,
      recentHistory: [
        {
          ...(baseline.viewModel.recentHistory[0] ?? {}),
          id: "e2e-confirmed-global-reset",
          key: "e2e-confirmed-global-reset",
          resetAt,
          recordKind: "confirmed_global",
          title: resetTitle,
        },
        ...baseline.viewModel.recentHistory,
      ],
    },
  };
  await page.route("**/api/current?**", async (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify(publishReset ? updated : baseline),
  }));
  await page.route("**/api/reset-marker", async (route) => {
    markerPolls += 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(publishReset
        ? { schemaVersion: "reset-marker-v1", marker: "e2e-confirmed-global-reset", resetAt }
        : { schemaVersion: "reset-marker-v1", marker: baseline.lastRandomResetAt, resetAt: baseline.lastRandomResetAt }),
    });
  });
  await page.route("**/api/current/heatmap?**", (route) => route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ eventTimes: [] }),
  }));

  let documentRequests = 0;
  page.on("request", (request) => {
    if (request.resourceType() === "document") documentRequests += 1;
  });
  await page.goto("/");
  await expect.poll(() => markerPolls).toBe(1);
  const heatmap = page.getByRole("region", { name: "過去のランダムリセット時刻" });
  await heatmap.getByRole("button", { name: "全期間" }).click();
  const countLabel = heatmap.getByText(/リセット件数: n=/);
  const countText = await countLabel.textContent();
  const initialCount = Number(countText?.match(/n=(\d+)/)?.[1]);
  expect(Number.isInteger(initialCount)).toBe(true);

  publishReset = true;
  await page.clock.fastForward(5 * 60 * 1000);
  await expect.poll(() => markerPolls).toBeGreaterThan(1);
  await expect(page.getByText(resetTitle, { exact: true })).toBeVisible();
  await expect(heatmap.getByText(`リセット件数: n=${initialCount}`, { exact: true })).toBeVisible();
  expect(documentRequests).toBe(1);
  await expectNoBrowserErrors(errors);
});
