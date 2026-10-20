import { expect, test } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";

const extensionRoot = path.join(process.cwd(), "extension/tibo-monitor");
const replyTweetId = "2099000000000000001";

test("captures a verified reply while bounded recovery reveals it below a foreign parent", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 1000 });
  await page.addInitScript(() => {
    const testWindow = window as typeof window & {
      chrome: any;
      __tiboCapturedPosts: any[];
      __tiboTimelineReports: any[];
      __tiboParentExpandCount: number;
    };
    const state: Record<string, unknown> = {};
    testWindow.__tiboCapturedPosts = [];
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

  await page.route("https://x.com/thsottiaux/with_replies", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "text/html",
      body: `<!doctype html>
        <html><head><title>Reply capture fixture</title>
          <style>
            html, body { margin: 0; font: 16px sans-serif; }
            #timeline { width: 600px; }
            article { box-sizing: border-box; width: 600px; border: 1px solid #ddd; }
            .parent { height: 900px; }
            .row { display: flex; gap: 12px; }
            .avatar-column { width: 48px; }
            .connector { height: 20px; }
            .spacer { height: 1600px; }
          </style>
        </head><body>
          <main id="timeline">
            <article class="parent" data-testid="tweet">
              <div class="row">
                <div class="avatar-column">
                  <div data-testid="Tweet-User-Avatar"></div>
                  <div class="connector"><i></i><i></i></div>
                </div>
                <div>
                  <div data-testid="User-Name">
                    <a href="/thirdparty">@thirdparty</a>
                    <a href="/thirdparty/status/2098999999999999000"><time datetime="2026-10-21T00:00:00.000Z"></time></a>
                  </div>
                  <div data-testid="tweetText">A long third-party parent post that dominates the viewport.</div>
                  <button aria-label="Show more" onclick="window.__tiboParentExpandCount += 1">Show more</button>
                </div>
              </div>
            </article>
            <div class="spacer"></div>
          </main>
          <script>
            window.addEventListener("scroll", () => {
              if (window.scrollY < 500 || document.querySelector("#tibo-reply")) return;
              const cell = document.createElement("div");
              cell.innerHTML = '<article id="tibo-reply" data-testid="tweet">'
                + '<div data-testid="replyContext">Replying to <a href="/thirdparty">@thirdparty</a></div>'
                + '<div class="row"><div class="avatar-column"><div data-testid="Tweet-User-Avatar"></div></div><div>'
                + '<div data-testid="User-Name"><a href="/thsottiaux">Tibo</a>'
                + '<a href="/thsottiaux/status/${replyTweetId}"><time datetime="2026-10-21T00:01:00.000Z"></time></a></div>'
                + '<div data-testid="tweetText">Verified reply body.</div></div></div></article>';
              document.querySelector("#timeline")?.appendChild(cell);
            });
          </script>
        </body></html>`,
    });
  });

  await page.goto("https://x.com/thsottiaux/with_replies");
  for (const fileName of ["diagnostics.js", "runtime.js", "scan-utils.js", "content.js"]) {
    await page.addScriptTag({ path: path.join(extensionRoot, fileName) });
  }

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

  const pageState = await page.evaluate(() => ({
    scrollY: window.scrollY,
    parentExpandCount: (window as any).__tiboParentExpandCount,
    reports: (window as any).__tiboTimelineReports,
  }));
  expect(pageState.scrollY).toBeGreaterThan(0);
  expect(pageState.parentExpandCount).toBe(0);
  expect(pageState.reports.some((summary: any) => summary.sourceTimeline === "with_replies")).toBe(true);
  expect(pageState.reports.every((summary: any) => summary.recoveryMaxMoves === 4)).toBe(true);
  expect(JSON.stringify(pageState.reports)).not.toContain("Verified reply body.");
  expect(JSON.stringify(pageState.reports)).not.toContain("@thirdparty");
  expect(JSON.stringify(pageState.reports)).not.toContain("A long third-party parent post");

  await page.close();
});
