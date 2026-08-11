import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

import { parseTiboReplyMetadata } from "../lib/radar/tiboReplyMetadata";

type FakeElementOptions = {
  text?: string;
  attributes?: Record<string, string>;
  marker?: FakeElement | null;
  links?: FakeElement[];
  nestedArticles?: FakeElement[];
  tweetText?: FakeElement | null;
  quote?: FakeElement | null;
  throwOnQuote?: boolean;
};

class FakeElement {
  innerText: string;
  private readonly attributes: Record<string, string>;
  private readonly marker: FakeElement | null;
  private readonly links: FakeElement[];
  private readonly nestedArticles: FakeElement[];
  private readonly tweetText: FakeElement | null;
  private readonly quote: FakeElement | null;
  private readonly throwOnQuote: boolean;

  constructor(options: FakeElementOptions = {}) {
    this.innerText = options.text || "";
    this.attributes = options.attributes || {};
    this.marker = options.marker || null;
    this.links = options.links || [];
    this.nestedArticles = options.nestedArticles || [];
    this.tweetText = options.tweetText || null;
    this.quote = options.quote || null;
    this.throwOnQuote = options.throwOnQuote === true;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  querySelector(selector: string) {
    if (selector.includes("socialContext") || selector.includes("replyContext") || selector.includes("Replying to") || selector.includes("返信先") || selector.includes("回复给")) {
      return this.marker;
    }
    if (selector.includes('data-testid="tweetText"')) {
      return this.tweetText;
    }
    if (selector.includes("quoteTweet") || selector.includes("quotedTweet") || selector.includes("Quoted")) {
      if (this.throwOnQuote) throw new Error("quote DOM unavailable");
      return this.quote;
    }
    return null;
  }

  querySelectorAll(selector: string) {
    if (selector.includes("a[href")) return this.links;
    if (selector.includes('article[data-testid="tweet"]')) return this.nestedArticles;
    return [];
  }
}

function loadScanUtils() {
  const code = fs.readFileSync(
    path.join(process.cwd(), "extension/tibo-monitor/scan-utils.js"),
    "utf8",
  );
  const context = vm.createContext({ URL, Date });
  vm.runInContext(code, context);
  return (context as typeof context & {
    TiboMonitorScan: {
      getTimelineSource: (url: string) => string | null;
      extractReplyMetadata: (article: FakeElement) => {
        isReply: boolean;
        replyToHandles: string[];
        replyContextText: string | null;
        isQuote: boolean;
        quoteContextText: string | null;
        quoteTweetUrl: string | null;
        quoteAuthorHandle: string | null;
      };
    };
  }).TiboMonitorScan;
}

test("reply metadata parser accepts bounded optional metadata and keeps old payloads valid", () => {
  assert.deepEqual(parseTiboReplyMetadata({}), {
    ok: true,
    value: {},
  });
  assert.deepEqual(
    parseTiboReplyMetadata({
      isReply: true,
      replyToHandles: ["alice", "@alice", "bob_2"],
      replyContextText: "  Parent context  ",
      sourceTimeline: "with_replies",
    }),
    {
      ok: true,
      value: {
        isReply: true,
        replyToHandles: ["@alice", "@bob_2"],
        replyContextText: "Parent context",
        sourceTimeline: "with_replies",
      },
    },
  );
});

test("reply metadata parser rejects unsafe or oversized supplied values", () => {
  assert.equal(parseTiboReplyMetadata({ isReply: "true" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ sourceTimeline: "notifications" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ replyToHandles: ["not a handle"] }).ok, false);
  assert.equal(parseTiboReplyMetadata({ replyContextText: "x".repeat(1001) }).ok, false);
});

test("quote metadata parser accepts safe nullable fields and normalizes the handle", () => {
  assert.deepEqual(
    parseTiboReplyMetadata({
      isQuote: true,
      quoteContextText: "  So what about our reset?  ",
      quoteTweetUrl: "https://x.com/blueemi99/status/1234567890",
      quoteAuthorHandle: "blueemi99",
    }),
    {
      ok: true,
      value: {
        isQuote: true,
        quoteContextText: "So what about our reset?",
        quoteTweetUrl: "https://x.com/blueemi99/status/1234567890",
        quoteAuthorHandle: "@blueemi99",
      },
    },
  );
});

test("quote metadata parser rejects unsafe or oversized fields", () => {
  assert.equal(parseTiboReplyMetadata({ quoteAuthorHandle: "@not-valid-handle!" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ quoteTweetUrl: "https://evil.example/status/123" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ quoteContextText: "x".repeat(1001) }).ok, false);
});

test("timeline source recognizes profile and with-replies pages on both X hosts", () => {
  const scan = loadScanUtils();
  assert.equal(scan.getTimelineSource("https://x.com/thsottiaux"), "profile");
  assert.equal(scan.getTimelineSource("https://x.com/thsottiaux/with_replies"), "with_replies");
  assert.equal(scan.getTimelineSource("https://twitter.com/thsottiaux/with_replies/"), "with_replies");
  assert.equal(scan.getTimelineSource("https://x.com/thsottiaux/status/123"), null);
});

test("explicit Replying to DOM metadata identifies a reply and visible parent context", () => {
  const scan = loadScanUtils();
  const link = new FakeElement({ attributes: { href: "/alice" } });
  const marker = new FakeElement({
    text: "Replying to @alice",
    attributes: { "aria-label": "Replying to @alice" },
    links: [link],
  });
  const parentText = new FakeElement({ text: "The parent post is visible." });
  const parent = new FakeElement({ tweetText: parentText });
  const article = new FakeElement({ marker, nestedArticles: [parent] });

  assert.equal(JSON.stringify(scan.extractReplyMetadata(article)), JSON.stringify({
    isReply: true,
    replyToHandles: ["@alice"],
    replyContextText: "The parent post is visible.",
    isQuote: false,
    quoteContextText: null,
    quoteTweetUrl: null,
    quoteAuthorHandle: null,
  }));
});

test("quote card metadata is collected best-effort without changing author text", () => {
  const scan = loadScanUtils();
  const quoteText = new FakeElement({ text: "So what about our reset?" });
  const quoteLink = new FakeElement({
    attributes: { href: "https://x.com/blueemi99/status/9876543210" },
  });
  const quote = new FakeElement({ tweetText: quoteText, links: [quoteLink] });
  const article = new FakeElement({ quote });

  assert.equal(JSON.stringify(scan.extractReplyMetadata(article)), JSON.stringify({
    isReply: false,
    replyToHandles: [],
    replyContextText: null,
    isQuote: true,
    quoteContextText: "So what about our reset?",
    quoteTweetUrl: "https://x.com/blueemi99/status/9876543210",
    quoteAuthorHandle: "@blueemi99",
  }));
});

test("quote DOM failures do not stop ordinary tweet collection", () => {
  const scan = loadScanUtils();
  const article = new FakeElement({ throwOnQuote: true });

  assert.equal(JSON.stringify(scan.extractReplyMetadata(article)), JSON.stringify({
    isReply: false,
    replyToHandles: [],
    replyContextText: null,
    isQuote: false,
    quoteContextText: null,
    quoteTweetUrl: null,
    quoteAuthorHandle: null,
  }));
});

test("a normal post or contextless reply does not invent reply context", () => {
  const scan = loadScanUtils();
  const normalArticle = new FakeElement({ text: "A normal post" });
  assert.equal(JSON.stringify(scan.extractReplyMetadata(normalArticle)), JSON.stringify({
    isReply: false,
    replyToHandles: [],
    replyContextText: null,
    isQuote: false,
    quoteContextText: null,
    quoteTweetUrl: null,
    quoteAuthorHandle: null,
  }));

  const marker = new FakeElement({ text: "Replying to @alice", links: [] });
  const replyWithoutParent = new FakeElement({ marker, nestedArticles: [] });
  assert.equal(JSON.stringify(scan.extractReplyMetadata(replyWithoutParent)), JSON.stringify({
    isReply: true,
    replyToHandles: ["@alice"],
    replyContextText: null,
    isQuote: false,
    quoteContextText: null,
    quoteTweetUrl: null,
    quoteAuthorHandle: null,
  }));
});
