import { expect, test, type Page } from "@playwright/test";
import path from "node:path";

const extensionRoot = path.join(process.cwd(), "extension/tibo-monitor");
const replyTweetId = "2099000000000000001";
const parentTweetId = "2098999999999999000";
const timelineUrl = "https://x.com/thsottiaux/with_replies";

async function installReplyFixture(
  page: Page,
  options: { parentHeight: number; materializeAt: number },
) {
  await page.setViewportSize({ width: 1280, height: 1_000 });
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      chrome: any;
      __tiboCapturedPosts: any[];
      __tiboContextEnrichments: any[];
      __tiboTimelineReports: any[];
      __tiboParentExpandCount: number;
    };
    const state: Record<string, unknown> = {};
    testWindow.__tiboCapturedPosts = [];
    testWindow.__tiboContextEnrichments = [];
    testWindow.__tiboTimelineReports = [];
    testWindow.__tiboParentExpandCount = 0;
    testWindow.chrome = {
      runtime: {
        lastError: undefined,
        onMessage: { addListener() {} },
        sendMessage(message: any, callback?: (response: any) => void) {
          if (message.action === "POST_TWEET") {
            testWindow.__tiboCapturedPosts.push(message.payload);
          }
          if (message.action === "POST_TWEET_CONTEXT_ENRICHMENT") {
            testWindow.__tiboContextEnrichments.push(message.payload);
          }
          if (message.action === "REPORT_TIMELINE_SCAN") {
            testWindow.__tiboTimelineReports.push(message.summary);
          }
          if (message.action === "GET_CONTENT_MONITOR_STATE") {
            callback?.({
              success: true,
              data: Object.fromEntries((message.keys || []).map((key: string) => [key, state[key]])),
            });
            return;
          }
          if (message.action === "SET_CONTENT_MONITOR_STATE") {
            Object.assign(state, message.items || {});
          }
          callback?.({ success: true, data: {} });
        },
      },
      storage: {
        local: {
          async get(keys: string[]) {
            return Object.fromEntries(keys.map((key) => [key, state[key]]));
          },
          async set(items: Record<string, unknown>) {
            Object.assign(state, items);
          },
        },
      },
    };
  });

  await page.route(timelineUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html>
        <html><head><title>Reply capture fixture</title>
          <style>
            html, body { margin: 0; font: 16px sans-serif; }
            #timeline { width: 600px; }
            article { box-sizing: border-box; width: 600px; border: 1px solid #ddd; }
            #foreign-parent { height: ${options.parentHeight}px; }
            .tweet-inner { height: 100%; }
            .thread-row { height: 24px; }
            .body-row { display: flex; gap: 12px; }
            .avatar-column { width: 48px; flex: 0 0 48px; }
            .thread-line { height: 24px; }
            .tail-spacer { height: 1600px; }
          </style>
        </head><body>
          <main id="timeline">
            <div data-testid="cellInnerDiv" id="foreign-cell">
              <article id="foreign-parent" data-testid="tweet">
                <div class="tweet-inner">
                  <div class="thread-row"><div class="empty-stub"></div></div>
                  <div class="body-row">
                    <div class="avatar-column">
                      <div data-testid="Tweet-User-Avatar"></div>
                      <div class="thread-line"><i></i><i></i></div>
                    </div>
                    <div>
                      <div data-testid="User-Name">
                        <a href="/thirdparty">@thirdparty</a>
                        <a href="/thirdparty/status/${parentTweetId}"><time datetime="2026-10-21T00:00:00.000Z"></time></a>
                      </div>
                      <div data-testid="tweetText" id="foreign-parent-text">
                        <span>A long third-party parent opening.</span>
                        <button id="expand-parent" role="button">Show more</button>
                      </div>
                    </div>
                  </div>
                </div>
              </article>
            </div>
            <div class="tail-spacer"></div>
          </main>
          <script>
            let replyAdded = false;
            document.getElementById("expand-parent").addEventListener("click", () => {
              window.__tiboParentExpandCount += 1;
              const text = document.getElementById("foreign-parent-text");
              text.innerText = "The verified complete third-party parent context.";
            });
            window.addEventListener("scroll", () => {
              if (replyAdded || window.scrollY < ${options.materializeAt}) return;
              replyAdded = true;
              const cell = document.createElement("div");
              cell.setAttribute("data-testid", "cellInnerDiv");
              cell.id = "tibo-reply-cell";
              cell.innerHTML = '<article id="tibo-reply" data-testid="tweet">'
                + '<div class="tweet-inner">'
                + '<div class="thread-row"><div class="incoming-connector"><i></i><i></i></div></div>'
                + '<div class="body-row"><div class="avatar-column"><div data-testid="Tweet-User-Avatar"></div></div><div>'
                + '<div data-testid="User-Name"><a href="/thsottiaux">Tibo</a>'
                + '<a href="/thsottiaux/status/${replyTweetId}"><time datetime="2026-10-21T00:01:00.000Z"></time></a></div>'
                + '<div data-testid="tweetText">Verified reply body.</div></div></div>'
                + '</div></article>';
              document.getElementById("foreign-cell").after(cell);
            });
          </script>
        </body></html>`,
    });
  });

  await page.goto(timelineUrl);
  for (const fileName of ["diagnostics.js", "runtime.js", "scan-utils.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(extensionRoot, fileName) });
  }
}

test("captures a markerless connector reply after one bounded jump past a multi-viewport parent", async ({ page }) => {
  await installReplyFixture(page, { parentHeight: 4_200, materializeAt: 3_500 });

  await expect.poll(async () => page.evaluate(() => (window as any).__tiboCapturedPosts.length)).toBe(1);
  const posts = await page.evaluate(() => (window as any).__tiboCapturedPosts);
  expect(posts).toHaveLength(1);
  expect(posts[0]).toMatchObject({
    tweetId: replyTweetId,
    text: "Verified reply body.",
    isReply: true,
    replyToHandles: ["@thirdparty"],
    replyContextText: null,
    sourceTimeline: "with_replies",
  });

  const beforeContext = await page.evaluate(() => ({
    scrollY: window.scrollY,
    parentExpandCount: (window as any).__tiboParentExpandCount,
    reports: (window as any).__tiboTimelineReports,
  }));
  expect(beforeContext.scrollY).toBeGreaterThan(3_000);
  expect(beforeContext.parentExpandCount).toBe(0);
  expect(beforeContext.reports.some((summary: any) => summary.sourceTimeline === "with_replies")).toBe(true);
  expect(beforeContext.reports.every((summary: any) => summary.recoveryMaxMoves === 4)).toBe(true);
  expect(JSON.stringify(beforeContext.reports)).not.toContain("Verified reply body.");
  expect(JSON.stringify(beforeContext.reports)).not.toContain("@thirdparty");
  expect(JSON.stringify(beforeContext.reports)).not.toContain("The verified complete third-party parent context.");

  await page.getByRole("button", { name: "Show more" }).click();
  await expect.poll(async () => page.evaluate(() => (window as any).__tiboContextEnrichments.length)).toBe(1);
  const enrichments = await page.evaluate(() => (window as any).__tiboContextEnrichments);
  expect(enrichments).toHaveLength(1);
  expect(enrichments[0]).toMatchObject({
    kind: "source_context_enrichment",
    tweetId: replyTweetId,
    replyParentTweetId: parentTweetId,
    replyParentTweetUrl: `https://x.com/thirdparty/status/${parentTweetId}`,
    replyContextText: "The verified complete third-party parent context.",
  });
  await page.close();
});

test("a trusted user scroll stops bounded recovery before it starts", async ({ page }) => {
  await installReplyFixture(page, { parentHeight: 100, materializeAt: 20_000 });
  await expect.poll(async () => page.evaluate(() => (window as any).__tiboTimelineReports.length)).toBeGreaterThan(0);

  await page.mouse.wheel(0, 240);
  await page.waitForTimeout(50);
  const expectedScrollY = await page.evaluate(() => {
    document.getElementById("foreign-parent")!.style.height = "4500px";
    document.body.appendChild(document.createTextNode("re-scan after trusted input"));
    return window.scrollY;
  });
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__tiboTimelineReports.some((summary: any) => summary.recoveryStatus === "user_interrupted"),
  )).toBe(true);
  await page.waitForTimeout(900);

  const state = await page.evaluate(() => ({
    scrollY: window.scrollY,
    parentExpandCount: (window as any).__tiboParentExpandCount,
    posts: (window as any).__tiboCapturedPosts,
  }));
  expect(state.scrollY).toBe(expectedScrollY);
  expect(state.parentExpandCount).toBe(0);
  expect(state.posts).toHaveLength(0);
  await page.close();
});

test("reaching the per-tab movement budget leaves an unresolved reply partial", async ({ page }) => {
  await installReplyFixture(page, { parentHeight: 6_500, materializeAt: 5_200 });
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__tiboTimelineReports.some((summary: any) => summary.recoveryStatus === "target_not_visible"),
  )).toBe(true);

  const state = await page.evaluate(() => ({
    scrollY: window.scrollY,
    parentExpandCount: (window as any).__tiboParentExpandCount,
    posts: (window as any).__tiboCapturedPosts,
    reports: (window as any).__tiboTimelineReports,
  }));
  expect(state.scrollY).toBeLessThanOrEqual(4_000);
  expect(state.parentExpandCount).toBe(0);
  expect(state.posts).toHaveLength(0);
  expect(state.reports.at(-1).parseSuccessCount).toBe(0);
  expect(state.reports.at(-1).recoveryMoveCount).toBeLessThanOrEqual(4);

  await page.reload();
  await page.evaluate(() => window.scrollTo(0, 0));
  for (const fileName of ["diagnostics.js", "runtime.js", "scan-utils.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(extensionRoot, fileName) });
  }
  await expect.poll(async () => page.evaluate(() =>
    (window as any).__tiboTimelineReports.some((summary: any) => summary.recoveryStatus === "target_not_visible"),
  )).toBe(true);
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.scrollY)).toBe(0);
  expect(await page.evaluate(() => (window as any).__tiboCapturedPosts)).toHaveLength(0);
  await page.close();
});
