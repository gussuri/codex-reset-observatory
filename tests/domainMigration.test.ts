import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { NextRequest } from "next/server";

import { middleware } from "../middleware";
import { SITE_URL, siteUrl } from "../lib/siteMetadata";
import robots from "../app/robots";

const legacyHost = "codex-reset-observatory.vercel.app";
const newHost = "codex.gussuriworks.com";

function responseFor(url: string) {
  return middleware(new NextRequest(url));
}

test("legacy page requests permanently redirect to the fixed new domain", () => {
  const response = responseFor(`https://${legacyHost}/history?x=1`);

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get("location"),
    `https://${newHost}/history?x=1`,
  );
});

test("legacy API requests remain available during the extension migration", () => {
  for (const path of ["/api/current", "/api/webhook/tibo", "/api"]) {
    const response = responseFor(`https://${legacyHost}${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(response.headers.get("location"), null, path);
  }
});

test("new, preview, and localhost hosts are never redirected", () => {
  for (const url of [
    `https://${newHost}/`,
    "https://preview-codex-reset-observatory.vercel.app/en",
    "http://localhost:3000/history",
  ]) {
    const response = responseFor(url);
    assert.equal(response.status, 200, url);
    assert.equal(response.headers.get("location"), null, url);
  }
});

test("published site URLs and robots sitemap use the new domain", () => {
  assert.equal(SITE_URL, `https://${newHost}`);
  assert.equal(siteUrl("/en"), `https://${newHost}/en`);
  assert.equal(robots().sitemap, `https://${newHost}/sitemap.xml`);

  const sitemap = readFileSync("public/sitemap.xml", "utf8");
  assert.doesNotMatch(sitemap, new RegExp(legacyHost.replaceAll(".", "\\.")));
  assert.match(sitemap, new RegExp(`https://${newHost.replaceAll(".", "\\.")}/`));
});

test("extension keeps legacy access while defaulting all current links to the new domain", () => {
  const manifest = JSON.parse(readFileSync("extension/tibo-monitor/manifest.json", "utf8")) as {
    host_permissions: string[];
  };
  const serviceWorker = readFileSync("extension/tibo-monitor/service-worker.js", "utf8");
  const userScript = readFileSync("scripts/tibo-monitor.user.js", "utf8");
  const options = readFileSync("extension/tibo-monitor/options.html", "utf8");

  assert.ok(manifest.host_permissions.includes(`https://${newHost}/*`));
  assert.ok(manifest.host_permissions.includes(`https://${legacyHost}/*`));
  assert.match(serviceWorker, new RegExp(`DEFAULT_OBSERVATORY_DOMAIN = "https://${newHost}"`));
  assert.match(serviceWorker, new RegExp(`LEGACY_OBSERVATORY_DOMAIN = "https://${legacyHost}"`));
  assert.match(serviceWorker, /const TEST_HISTORY_URL = `\$\{DEFAULT_OBSERVATORY_DOMAIN\}\$\{HISTORY_PATH\}`;/);
  assert.match(userScript, new RegExp(`GM_getValue\\("observatory_domain", "https://${newHost}"\\)`));
  assert.match(userScript, new RegExp(`@connect      ${newHost}`));
  assert.match(userScript, new RegExp(`@connect      ${legacyHost}`));
  assert.match(options, new RegExp(`value="https://${newHost}"`));
});
