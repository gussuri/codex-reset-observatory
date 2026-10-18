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

type StructuralElementOptions = {
  tagName?: string;
  text?: string;
  attributes?: Record<string, string>;
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

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
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

class StructuralElement {
  readonly tagName: string;
  innerText: string;
  readonly children: StructuralElement[] = [];
  parentElement: StructuralElement | null = null;
  private readonly attributes: Record<string, string>;

  constructor(options: StructuralElementOptions = {}) {
    this.tagName = options.tagName || "div";
    this.innerText = options.text || "";
    this.attributes = options.attributes || {};
  }

  appendChild(child: StructuralElement) {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  get previousElementSibling(): StructuralElement | null {
    if (!this.parentElement) return null;
    const index = this.parentElement.children.indexOf(this);
    return index > 0 ? this.parentElement.children[index - 1] : null;
  }

  getAttribute(name: string) {
    return this.attributes[name] ?? null;
  }

  setAttribute(name: string, value: string) {
    this.attributes[name] = value;
  }

  contains(candidate: StructuralElement | null) {
    if (!candidate) return false;
    let current: StructuralElement | null = candidate;
    while (current) {
      if (current === this) return true;
      current = current.parentElement;
    }
    return false;
  }

  closest(selector: string) {
    let current: StructuralElement | null = this;
    while (current) {
      if (matchesSelector(current, selector)) return current;
      current = current.parentElement;
    }
    return null;
  }

  querySelector(selector: string) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector: string) {
    const matches: StructuralElement[] = [];
    const selectorParts = selector.split(",").map((part) => part.trim());
    const visit = (node: StructuralElement) => {
      for (const child of node.children) {
        if (selectorParts.some((part) => matchesSelector(child, part))) matches.push(child);
        visit(child);
      }
    };
    visit(this);
    return matches;
  }
}

function matchesSelector(element: StructuralElement, selector: string) {
  if (selector === "time") return element.tagName === "time";
  if (selector.startsWith("div[data-testid=") && selector.endsWith("]")) {
    return element.tagName === "div" && element.getAttribute("data-testid") === selector.slice(17, -2).replaceAll('"', "");
  }
  if (selector === 'article[data-testid="tweet"]') {
    return element.tagName === "article" && element.getAttribute("data-testid") === "tweet";
  }
  const testIdMatch = selector.match(/^\[data-testid="([^"]+)"\]$/);
  if (testIdMatch) return element.getAttribute("data-testid") === testIdMatch[1];
  if (selector === 'a[href]') {
    return element.tagName === "a" && Boolean(element.getAttribute("href"));
  }
  if (selector === 'a[href*="/status/"]') {
    return element.tagName === "a" && (element.getAttribute("href") || "").includes("/status/");
  }
  if (selector === '[data-testid="User-Name"]') {
    return element.getAttribute("data-testid") === "User-Name";
  }
  if (selector === 'a[href*="/status/"]') {
    return element.tagName === "a" && (element.getAttribute("href") || "").includes("/status/");
  }
  if (selector === "button") return element.tagName === "button";
  if (selector === '[role="button"]') return element.getAttribute("role") === "button";
  return false;
}

function element(options: StructuralElementOptions = {}) {
  return new StructuralElement(options);
}

function makeThreadArticle(options: {
  id: string;
  handle?: string;
  text?: string;
  incoming?: boolean;
  outgoing?: boolean;
  quoteText?: string;
  expandLabel?: string | null;
  expandInsideText?: boolean;
}) {
  const cell = element({ attributes: { "data-testid": "cellInnerDiv" } });
  const article = element({ tagName: "article", attributes: { "data-testid": "tweet" } });
  const outer = element();
  const body = element();
  const threadRow = element();
  threadRow.appendChild(element());
  if (options.incoming) threadRow.appendChild(element());

  const bodyRow = element();
  const avatarColumn = element();
  avatarColumn.appendChild(element({ attributes: { "data-testid": "Tweet-User-Avatar" } }));
  if (options.outgoing) avatarColumn.appendChild(element());

  const contentColumn = element();
  const userName = element({ attributes: { "data-testid": "User-Name" } });
  userName.appendChild(element({
    tagName: "a",
    attributes: { href: `/${options.handle || "parent"}` },
  }));
  const permalink = element({
    tagName: "a",
    attributes: { href: `/${options.handle || "parent"}/status/${options.id}` },
  });
  permalink.appendChild(element({ tagName: "time", attributes: { datetime: "2026-10-18T00:00:00.000Z" } }));
  userName.appendChild(permalink);
  contentColumn.appendChild(userName);

  if (options.quoteText) {
    const quoteArticle = element({ tagName: "article", attributes: { "data-testid": "tweet" } });
    const quotePermalink = element({ tagName: "a", attributes: { href: "/quoted/status/444444444444444444" } });
    quotePermalink.appendChild(element({ tagName: "time" }));
    quoteArticle.appendChild(quotePermalink);
    const quoteText = element({ attributes: { "data-testid": "tweetText" }, text: options.quoteText });
    quoteArticle.appendChild(quoteText);
    contentColumn.appendChild(quoteArticle);
  }

  const tweetTextElement = element({
    attributes: { "data-testid": "tweetText" },
    text: options.text || "",
  });
  contentColumn.appendChild(tweetTextElement);
  if (options.expandLabel) {
    const expandControl = element({
      tagName: "button",
      text: options.expandLabel,
      attributes: { role: "button" },
    });
    if (options.expandInsideText !== false) tweetTextElement.appendChild(expandControl);
    else contentColumn.appendChild(expandControl);
  }
  bodyRow.appendChild(avatarColumn);
  bodyRow.appendChild(contentColumn);
  body.appendChild(threadRow);
  body.appendChild(bodyRow);
  outer.appendChild(body);
  article.appendChild(outer);
  cell.appendChild(article);
  return { cell, article };
}

function makeTimeline(...cells: StructuralElement[]) {
  const timeline = element();
  cells.forEach((cell) => timeline.appendChild(cell));
  return timeline;
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
      extractReplyMetadata: (article: FakeElement | StructuralElement, options?: { sourceTimeline?: string | null }) => {
        isReply: boolean;
        replyToHandles: string[];
        replyContextText: string | null;
        replyParentTweetId?: string;
        replyParentTweetUrl?: string;
        needsRetry?: boolean;
        needsExpansion?: boolean;
        replyContextExpandControl?: unknown;
        replyContextExpansionKey?: string;
        replyContextState?: string;
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

test("reply parent identity is paired, URL-bound, author-bound, and self-reference safe", () => {
  const valid = { tweetId: "999", isReply: true, replyToHandles: ["@parent"], replyParentTweetId: "123", replyParentTweetUrl: "https://x.com/parent/status/123" };
  assert.equal(parseTiboReplyMetadata(valid).ok, true);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyParentTweetId: "124" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyParentTweetUrl: "https://x.com/other/status/123" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyParentTweetUrl: "https://x.com/parent/status/123?x=1" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyParentTweetUrl: "https://user@x.com/parent/status/123" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, tweetId: "123" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ replyParentTweetId: "123" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ replyParentTweetUrl: "https://x.com/parent/status/123" }).ok, false);
  assert.equal(parseTiboReplyMetadata({ replyParentTweetId: null, replyParentTweetUrl: null }).ok, true);
  assert.equal(parseTiboReplyMetadata({ ...valid, isReply: false }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyToHandles: [] }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyToHandles: ["@wrong"] }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, replyToHandles: undefined }).ok, false);
  assert.equal(parseTiboReplyMetadata({ ...valid, isQuote: true, quoteTweetUrl: "https://x.com/quote/status/456" }).ok, true);
  assert.equal(parseTiboReplyMetadata({ isReply: true, replyToHandles: [], replyParentTweetId: null, replyParentTweetUrl: null }).ok, true);
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

test("with-replies sibling connectors recover the two observed Tibo reply parents", () => {
  const scan = loadScanUtils();
  const cases = [
    {
      id: "2089063967301730789",
      parentText: "are we going to get a reset when codex crosses 20M users?",
    },
    {
      id: "2089078284487139347",
      parentText: '"maybe" from tibo is basically a confirmed reset',
    },
  ];

  for (const testCase of cases) {
    const parent = makeThreadArticle({
      id: `parent-${testCase.id}`,
      handle: "Ananth7e",
      text: testCase.parentText,
      outgoing: true,
    });
    const child = makeThreadArticle({
      id: testCase.id,
      handle: "thsottiaux",
      text: "Maybe",
      incoming: true,
    });
    makeTimeline(parent.cell, child.cell);

    assert.equal(JSON.stringify(scan.extractReplyMetadata(child.article, { sourceTimeline: "with_replies" })), JSON.stringify({
      isReply: true,
      replyToHandles: ["@Ananth7e"],
      replyContextText: testCase.parentText,
      isQuote: false,
      quoteContextText: null,
      quoteTweetUrl: null,
      quoteAuthorHandle: null,
    }));
  }
});

test("collapsed sibling parent is held for expansion before webhook metadata is ready", () => {
  const scan = loadScanUtils();
  const parent = makeThreadArticle({
    id: "2100000000000000001",
    handle: "My_Ai_Bi",
    text: "Long parent opening...",
    expandLabel: "Show more",
    outgoing: true,
  });
  const child = makeThreadArticle({
    id: "2100000000000000002",
    handle: "thsottiaux",
    text: "3am on a tuesday",
    incoming: true,
  });
  makeTimeline(parent.cell, child.cell);

  const pending = scan.extractReplyMetadata(child.article, { sourceTimeline: "with_replies" });
  assert.equal(pending.needsRetry, true);
  assert.equal(pending.needsExpansion, true);
  assert.equal(pending.replyContextText, null);
  assert.equal(pending.isReply, true);
  assert.equal(JSON.stringify(pending.replyToHandles), JSON.stringify(["@My_Ai_Bi"]));
  assert.ok(pending.replyContextExpandControl);
  assert.equal(pending.replyContextExpansionKey, "2100000000000000001");
});

test("explicit Replying to markers also wait for a collapsed nested parent", () => {
  const scan = loadScanUtils();
  const article = element({ tagName: "article", attributes: { "data-testid": "tweet" } });
  const marker = element({
    attributes: { "data-testid": "socialContext" },
    text: "Replying to @alice",
  });
  marker.appendChild(element({ tagName: "a", attributes: { href: "/alice" } }));

  const parent = element({ tagName: "article", attributes: { "data-testid": "tweet" } });
  const parentText = element({ attributes: { "data-testid": "tweetText" }, text: "Long parent opening..." });
  parentText.appendChild(element({
    tagName: "button",
    text: "Show more",
    attributes: { role: "button" },
  }));
  parent.appendChild(parentText);
  article.appendChild(marker);
  article.appendChild(parent);

  const pending = scan.extractReplyMetadata(article);
  assert.equal(pending.needsRetry, true);
  assert.equal(pending.needsExpansion, true);
  assert.equal(pending.isReply, true);
  assert.equal(JSON.stringify(pending.replyToHandles), JSON.stringify(["@alice"]));
  assert.equal(pending.replyContextText, null);
  assert.ok(pending.replyContextExpandControl);
});

test("partial sibling parent without an expansion control is held without inventing context", () => {
  const scan = loadScanUtils();
  const parent = makeThreadArticle({
    id: "2100000000000000003",
    handle: "My_Ai_Bi",
    text: "",
    outgoing: true,
  });
  const child = makeThreadArticle({
    id: "2100000000000000004",
    handle: "thsottiaux",
    text: "3am on a tuesday",
    incoming: true,
  });
  makeTimeline(parent.cell, child.cell);

  const pending = scan.extractReplyMetadata(child.article, { sourceTimeline: "with_replies" });
  assert.equal(pending.needsRetry, true);
  assert.equal(pending.replyContextText, null);
  assert.equal(pending.replyContextState, "incomplete");
});

test("adjacent ordinary posts and connector mismatches are not treated as replies", () => {
  const scan = loadScanUtils();
  const ordinaryParent = makeThreadArticle({ id: "parent", handle: "alice", text: "ordinary" });
  const ordinaryChild = makeThreadArticle({ id: "child", handle: "thsottiaux", text: "Maybe" });
  makeTimeline(ordinaryParent.cell, ordinaryChild.cell);
  assert.equal(scan.extractReplyMetadata(ordinaryChild.article, { sourceTimeline: "with_replies" }).isReply, false);

  const incomingWithoutOutgoing = makeThreadArticle({ id: "child-2", handle: "thsottiaux", text: "Maybe", incoming: true });
  makeTimeline(ordinaryParent.cell, incomingWithoutOutgoing.cell);
  const mismatch = scan.extractReplyMetadata(incomingWithoutOutgoing.article, { sourceTimeline: "with_replies" });
  assert.equal(mismatch.isReply, false);
  assert.equal(mismatch.needsRetry, true);

  const outgoingWithoutIncoming = makeThreadArticle({ id: "parent-2", handle: "alice", text: "ordinary", outgoing: true });
  const noIncomingChild = makeThreadArticle({ id: "child-3", handle: "thsottiaux", text: "Maybe" });
  makeTimeline(outgoingWithoutIncoming.cell, noIncomingChild.cell);
  assert.equal(scan.extractReplyMetadata(noIncomingChild.article, { sourceTimeline: "with_replies" }).isReply, false);
});

test("an incoming connector without a rendered parent requests a retry", () => {
  const scan = loadScanUtils();
  const child = makeThreadArticle({ id: "partial", handle: "thsottiaux", text: "Maybe", incoming: true });

  assert.equal(JSON.stringify(scan.extractReplyMetadata(child.article, { sourceTimeline: "with_replies" })), JSON.stringify({
    isReply: false,
    replyToHandles: [],
    replyContextText: null,
    needsRetry: true,
    isQuote: false,
    quoteContextText: null,
    quoteTweetUrl: null,
    quoteAuthorHandle: null,
  }));
});

test("sibling parent context uses its own text, not nested quote text", () => {
  const scan = loadScanUtils();
  const parent = makeThreadArticle({
    id: "parent-with-quote",
    handle: "alice",
    text: "The parent's own post",
    quoteText: "Quoted text must not become the parent context",
    outgoing: true,
  });
  const child = makeThreadArticle({ id: "child-with-quote", handle: "thsottiaux", text: "Maybe", incoming: true });
  makeTimeline(parent.cell, child.cell);

  assert.equal(
    scan.extractReplyMetadata(child.article, { sourceTimeline: "with_replies" }).replyContextText,
    "The parent's own post",
  );
});

test("multi-level connectors recover the immediate parent on profile and with-replies pages", () => {
  const scan = loadScanUtils();
  const grandParent = makeThreadArticle({ id: "grand-parent", handle: "root", text: "root", outgoing: true });
  const parent = makeThreadArticle({ id: "parent-level", handle: "middle", text: "middle", incoming: true, outgoing: true });
  const child = makeThreadArticle({ id: "child-level", handle: "thsottiaux", text: "Maybe", incoming: true });
  makeTimeline(grandParent.cell, parent.cell, child.cell);

  assert.equal(
    scan.extractReplyMetadata(child.article, { sourceTimeline: "with_replies" }).replyContextText,
    "middle",
  );
  assert.equal(scan.extractReplyMetadata(child.article, { sourceTimeline: "profile" }).replyContextText, "middle");
});

test("profile thread extraction returns identity from the verified parent article", () => {
  const scan = loadScanUtils();
  const parent = makeThreadArticle({ id: "123456789012345678", handle: "parent", text: "parent body", outgoing: true });
  const child = makeThreadArticle({ id: "987654321098765432", handle: "thsottiaux", text: "child", incoming: true });
  makeTimeline(parent.cell, child.cell);
  assert.deepEqual(JSON.parse(JSON.stringify(scan.extractReplyMetadata(child.article, { sourceTimeline: "profile" }))), {
    isReply: true,
    replyToHandles: ["@parent"],
    replyContextText: "parent body",
    replyParentTweetId: "123456789012345678",
    replyParentTweetUrl: "https://x.com/parent/status/123456789012345678",
    isQuote: false,
    quoteContextText: null,
    quoteTweetUrl: null,
    quoteAuthorHandle: null,
  });
});

test("profile and with-replies ignore body status links when identifying parent provenance", () => {
  const scan = loadScanUtils();
  for (const sourceTimeline of ["profile", "with_replies"]) {
    const parent = makeThreadArticle({ id: "123456789012345678", handle: "thsottiaux", text: "Own parent body", outgoing: true });
    const text = parent.article.querySelector('[data-testid="tweetText"]')!;
    const unrelated = element({ tagName: "a", attributes: { href: "/unrelated/status/555555555555555555" } });
    text.appendChild(unrelated);
    const child = makeThreadArticle({ id: "987654321098765432", handle: "thsottiaux", text: "child", incoming: true });
    makeTimeline(parent.cell, child.cell);
    const metadata = scan.extractReplyMetadata(child.article, { sourceTimeline });
    assert.deepEqual(Array.from(metadata.replyToHandles), ["@thsottiaux"]);
    assert.equal(metadata.replyParentTweetId, "123456789012345678");
    assert.equal(metadata.replyParentTweetUrl, "https://x.com/thsottiaux/status/123456789012345678");
    assert.equal(metadata.replyContextText, "Own parent body");
  }
});

test("parent identity is unknown when author permalink evidence is ambiguous or mismatched", () => {
  const scan = loadScanUtils();
  for (const sourceTimeline of ["profile", "with_replies"]) {
    for (const mode of ["author-mismatch", "multiple-permalinks", "media-link"]) {
      const parent = makeThreadArticle({ id: "123456789012345678", handle: "thsottiaux", text: "Own parent body", outgoing: true, quoteText: "quoted body" });
      const userName = parent.article.querySelector('[data-testid="User-Name"]')!;
      const canonical = userName.querySelector('a[href*="/status/"]')!;
      if (mode === "author-mismatch") canonical.setAttribute("href", "/other/status/123456789012345678");
      if (mode === "multiple-permalinks") {
        const duplicate = element({ tagName: "a", attributes: { href: "/thsottiaux/status/222222222222222222" } });
        duplicate.appendChild(element({ tagName: "time" }));
        userName.appendChild(duplicate);
      }
      if (mode === "media-link") {
        const mediaLink = element({ tagName: "a", attributes: { href: "/media/status/333333333333333333" } });
        parent.article.appendChild(mediaLink);
        userName.children.splice(userName.children.indexOf(canonical), 1);
      }
      const child = makeThreadArticle({ id: "987654321098765432", handle: "thsottiaux", text: "child", incoming: true });
      makeTimeline(parent.cell, child.cell);
      const metadata = scan.extractReplyMetadata(child.article, { sourceTimeline });
      assert.equal(metadata.replyParentTweetId, undefined, `${sourceTimeline} ${mode}`);
      assert.equal(metadata.replyParentTweetUrl, undefined, `${sourceTimeline} ${mode}`);
      assert.equal(metadata.replyContextText, "Own parent body", `${sourceTimeline} ${mode}`);
      assert.deepEqual(Array.from(metadata.replyToHandles), ["@thsottiaux"], `${sourceTimeline} ${mode}`);
    }
  }
});

test("actual content and service worker scripts preserve parent provenance through retry", async () => {
  const storage: Record<string, unknown> = {
    webhook_secret: "test-only-secret",
    observatory_domain: "https://example.test",
  };
  const storageLocal = {
    async get(keys: string[]) {
      return Object.fromEntries(keys.filter((key) => Object.hasOwn(storage, key)).map((key) => [key, storage[key]]));
    },
    async set(items: Record<string, unknown>) { Object.assign(storage, items); },
    async setAccessLevel() {},
  };
  const listeners: Array<(request: any, sender: any, sendResponse: (response: any) => void) => unknown> = [];
  const postedBodies: Array<Record<string, unknown>> = [];
  let fetchCount = 0;
  const workerChrome = {
    storage: { local: storageLocal },
    runtime: {
      onMessage: { addListener(listener: typeof listeners[number]) { listeners.push(listener); } },
      onInstalled: { addListener() {} },
      onStartup: { addListener() {} },
      getManifest: () => ({ version: "test" }),
    },
    alarms: { get(_name: string, callback: (alarm: unknown) => void) { callback(null); }, create() {}, onAlarm: { addListener() {} } },
    tabs: { query: async () => [] },
  };
  const diagnostics = {
    appendDiagnosticLog: async () => {},
    markSuccessfulScan: async () => {},
  };
  const recordWebhookBody = (json: string) => postedBodies.push(JSON.parse(json));
  const workerSource = fs.readFileSync(path.join(process.cwd(), "extension/tibo-monitor/service-worker.js"), "utf8");
  const workerContext = vm.createContext({
    chrome: workerChrome,
    TiboDiagnostics: diagnostics,
    TiboMonitorScan: loadScanUtils(),
    importScripts() {},
    recordWebhookBody,
    fetch: async (url: string, init: { body?: string }) => {
      if (!url.endsWith("/api/webhook/tibo")) return { ok: true, status: 200, json: async () => ({}) };
      recordWebhookBody(init.body || "{}");
      fetchCount += 1;
      return fetchCount === 1
        ? { ok: false, status: 503, text: async () => "temporary" }
        : { ok: true, status: 200, json: async () => ({}) };
    },
    console,
  });
  vm.runInContext(`${workerSource}\nglobalThis.__retryPendingTweet = retryPendingTweet;`, workerContext);
  const workerResponses: Promise<void>[] = [];
  const dispatchToWorker = (request: any, callback: (response: any) => void) => {
    const listener = listeners[listeners.length - 1];
    workerResponses.push(new Promise((resolve) => {
      listener(request, {}, (response) => { callback(response); resolve(); });
    }));
  };

  const parent = makeThreadArticle({ id: "123456789012345678", handle: "parent_author", text: "Parent body provenance", outgoing: true });
  const child = makeThreadArticle({ id: "987654321098765432", handle: "thsottiaux", text: "Child body", incoming: true });
  const timeline = makeTimeline(parent.cell, child.cell);
  const allArticles = timeline.querySelectorAll('article[data-testid="tweet"]');
  const sendMessages: Array<Record<string, unknown>> = [];
  const scanTasks: Promise<unknown>[] = [];
  const contentChrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message: Record<string, unknown>, callback: (response: any) => void) {
        sendMessages.push(message);
        dispatchToWorker(message, callback);
      },
    },
  };
  const contentDiagnostics = {
    MAX_SNAPSHOT_CHARS: 100,
    buildScanSummary(records: Array<{ isParseSuccess?: boolean }>) {
      return { parseSuccessCount: records.filter((record) => record.isParseSuccess).length, articleCount: records.length };
    },
    getScanFailureReason: () => null,
  };
  const contentContext = vm.createContext({
    chrome: contentChrome,
    TiboMonitorScan: loadScanUtils(),
    TiboExtensionRuntime: {
      isExtensionContextInvalidated: () => false,
      async runSafely(task: () => Promise<unknown>) {
        const promise = task();
        scanTasks.push(promise);
        return promise;
      },
    },
    TiboDiagnostics: contentDiagnostics,
    document: { body: {}, querySelectorAll: () => allArticles },
    window: { location: { href: "https://x.com/thsottiaux", pathname: "/thsottiaux" } },
    sessionStorage: { getItem: () => "test-session", setItem() {} },
    MutationObserver: class { observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    URL,
    Blob,
    console,
  });
  const contentSource = fs.readFileSync(path.join(process.cwd(), "extension/tibo-monitor/content.js"), "utf8");
  vm.runInContext(contentSource, contentContext);
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);

  const contentMessage = sendMessages.find((message) => message.action === "POST_TWEET") as { payload: Record<string, unknown> };
  assert.ok(contentMessage, "the real content script should dispatch POST_TWEET");
  assert.equal(contentMessage.payload.replyParentTweetId, "123456789012345678");
  assert.equal(contentMessage.payload.replyParentTweetUrl, "https://x.com/parent_author/status/123456789012345678");
  assert.deepEqual(Array.from(contentMessage.payload.replyToHandles as string[]), ["@parent_author"]);
  assert.equal(contentMessage.payload.replyContextText, "Parent body provenance");
  assert.equal(contentMessage.payload.text, "Child body");
  assert.equal(postedBodies.length, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(postedBodies[0])), JSON.parse(JSON.stringify(contentMessage.payload)));
  assert.ok(Array.isArray(storage.tibo_pending_tweet_payloads));
  assert.equal((storage.tibo_pending_tweet_payloads as Array<{ payload: Record<string, unknown> }>)[0].payload.replyParentTweetUrl, contentMessage.payload.replyParentTweetUrl);

  const pending = storage.tibo_pending_tweet_payloads as Array<{ nextAttemptAt: number }>;
  pending[0].nextAttemptAt = 0;
  await (workerContext as typeof workerContext & { __retryPendingTweet: () => Promise<unknown> }).__retryPendingTweet();
  assert.equal(postedBodies.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(postedBodies[1])), JSON.parse(JSON.stringify(contentMessage.payload)));
  assert.equal(postedBodies[1].replyParentTweetId, "123456789012345678");
  assert.equal(postedBodies[1].replyParentTweetUrl, "https://x.com/parent_author/status/123456789012345678");
  assert.equal(postedBodies[1].replyContextText, "Parent body provenance");
  assert.deepEqual(Array.from(postedBodies[1].replyToHandles as string[]), ["@parent_author"]);
});

test("actual content and worker enrich a processed profile tweet from later with_replies evidence and retry it", async () => {
  const storage: Record<string, unknown> = { webhook_secret: "test-only-secret", observatory_domain: "https://example.test" };
  const storageLocal = {
    async get(keys: string[]) { return Object.fromEntries(keys.filter((key) => Object.hasOwn(storage, key)).map((key) => [key, storage[key]])); },
    async set(items: Record<string, unknown>) { Object.assign(storage, items); },
    async setAccessLevel() {},
  };
  const listeners: Array<(request: any, sender: any, sendResponse: (response: any) => void) => unknown> = [];
  const postedBodies: Array<Record<string, unknown>> = [];
  const storedSourceContexts = new Map<string, Record<string, unknown>>();
  let fetchCount = 0;
  let sourceConflict = false;
  let delayedTweetId: string | null = null;
  const delayedPost = { release: () => {} };
  let notifyDelayedPostStarted: (() => void) | null = null;
  const workerChrome = {
    storage: { local: storageLocal },
    runtime: { onMessage: { addListener(listener: typeof listeners[number]) { listeners.push(listener); } }, onInstalled: { addListener() {} }, onStartup: { addListener() {} }, getManifest: () => ({ version: "test" }) },
    alarms: { get(_name: string, callback: (alarm: unknown) => void) { callback(null); }, create() {}, onAlarm: { addListener() {} } },
    tabs: { query: async () => [] },
  };
  const workerContext = vm.createContext({
    chrome: workerChrome,
    TiboDiagnostics: { appendDiagnosticLog: async () => {}, markSuccessfulScan: async () => {} },
    TiboMonitorScan: loadScanUtils(),
    importScripts() {},
    crypto: (await import("node:crypto")).webcrypto,
    TextEncoder: (await import("node:util")).TextEncoder,
    URL,
    fetch: async (url: string, init: { body?: string }) => {
      if (!url.endsWith("/api/webhook/tibo")) return { ok: true, status: 200, json: async () => ({}) };
      const body = JSON.parse(init.body || "{}") as Record<string, unknown>;
      postedBodies.push(body);
      fetchCount += 1;
      if (body.kind !== "source_context_enrichment" && body.tweetId === delayedTweetId) {
        notifyDelayedPostStarted?.();
        await new Promise<void>((resolve) => { delayedPost.release = resolve; });
      }
      if (body.kind === "source_context_enrichment" && fetchCount === 2) return { ok: false, status: 503, text: async () => "temporary" };
      if (body.kind === "source_context_enrichment" && sourceConflict) return { ok: false, status: 409, text: async () => "conflict" };
      if (body.kind === "source_context_enrichment") {
        const tweetId = String(body.tweetId);
        storedSourceContexts.set(tweetId, {
          ...(body.replyParentTweetId ? { parent: {
            tweetId: body.replyParentTweetId,
            tweetUrl: body.replyParentTweetUrl,
            text: body.replyContextText,
          } } : {}),
          ...(body.quoteTweetUrl ? { quote: { tweetUrl: body.quoteTweetUrl, text: body.quoteContextText } } : {}),
        });
      }
      return { ok: true, status: 200, json: async () => body.kind === "source_context_enrichment"
        ? { success: true, status: "applied" }
        : { success: true } };
    },
    console,
  });
  const workerSource = fs.readFileSync(path.join(process.cwd(), "extension/tibo-monitor/service-worker.js"), "utf8");
  vm.runInContext(`${workerSource}\nglobalThis.__retryPendingTweet = retryPendingTweet;`, workerContext);
  const workerResponses: Promise<void>[] = [];
  const workerResponseResults: Array<{ action: string; response: any }> = [];
  const dispatchToWorker = (request: any, callback: (response: any) => void) => {
    const listener = listeners[listeners.length - 1];
    workerResponses.push(new Promise((resolve) => listener(request, {}, (response) => {
      workerResponseResults.push({ action: request.action, response });
      callback(response);
      resolve();
    })));
  };

  const child = makeThreadArticle({ id: "987654321098765432", handle: "thsottiaux", text: "Child body" });
  const lateReplyChild = makeThreadArticle({ id: "987654321098765432", handle: "thsottiaux", text: "Child body", incoming: true });
  const parent = makeThreadArticle({ id: "123456789012345678", handle: "parent_author", text: "Late parent evidence", outgoing: true });
  let allArticles = [child.article];
  const observer = { callback: () => {} };
  const scanTasks: Promise<unknown>[] = [];
  const sendMessages: Array<Record<string, unknown>> = [];
  const contentChrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(message: Record<string, unknown>, callback: (response: any) => void) {
        sendMessages.push(message);
        dispatchToWorker(message, callback);
      },
    },
  };
  const contentContext = vm.createContext({
    chrome: contentChrome,
    TiboMonitorScan: loadScanUtils(),
    TiboExtensionRuntime: {
      isExtensionContextInvalidated: () => false,
      async runSafely(task: () => Promise<unknown>) { const promise = task(); scanTasks.push(promise); return promise; },
    },
    TiboDiagnostics: {
      MAX_SNAPSHOT_CHARS: 100,
      buildScanSummary(records: Array<{ isParseSuccess?: boolean }>) { return { parseSuccessCount: records.filter((record) => record.isParseSuccess).length, articleCount: records.length }; },
      getScanFailureReason: () => null,
    },
    document: { body: {}, querySelectorAll: () => allArticles },
    window: { location: { href: "https://x.com/thsottiaux", pathname: "/thsottiaux" } },
    sessionStorage: { getItem: () => "test-session", setItem() {} },
    MutationObserver: class { constructor(callback: () => void) { observer.callback = callback; } observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    URL,
    Blob,
    console,
  });
  const contentSource = fs.readFileSync(path.join(process.cwd(), "extension/tibo-monitor/content.js"), "utf8");
  vm.runInContext(contentSource, contentContext);
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 1, "profile post is processed first");
  assert.ok((storage.tibo_processed_tweet_ids as string[] | undefined)?.includes("987654321098765432"), "profile tweet ID remains in the legacy processed ID list");
  assert.equal(postedBodies[0].kind, undefined, "first submission remains the ordinary post path");

  allArticles = makeTimeline(parent.cell, lateReplyChild.cell).querySelectorAll('article[data-testid="tweet"]');
  const lateObserver = { callback: () => {} };
  const lateContentContext = vm.createContext({
    chrome: contentChrome,
    TiboMonitorScan: loadScanUtils(),
    TiboExtensionRuntime: {
      isExtensionContextInvalidated: () => false,
      async runSafely(task: () => Promise<unknown>) { const promise = task(); scanTasks.push(promise); return promise; },
    },
    TiboDiagnostics: {
      MAX_SNAPSHOT_CHARS: 100,
      buildScanSummary(records: Array<{ isParseSuccess?: boolean }>) { return { parseSuccessCount: records.filter((record) => record.isParseSuccess).length, articleCount: records.length }; },
      getScanFailureReason: () => null,
    },
    document: { body: {}, querySelectorAll: () => allArticles },
    window: { location: { href: "https://x.com/thsottiaux/with_replies", pathname: "/thsottiaux/with_replies" } },
    sessionStorage: { getItem: () => "test-session", setItem() {} },
    MutationObserver: class { constructor(callback: () => void) { lateObserver.callback = callback; } observe() {} disconnect() {} },
    setInterval: () => 1,
    clearInterval() {},
    setTimeout: () => 1,
    clearTimeout() {},
    URL,
    Blob,
    console,
  });
  vm.runInContext(contentSource, lateContentContext);
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  await Promise.all(workerResponses);
  const skippedPostResponse = workerResponseResults.filter((entry) => entry.action === "POST_TWEET").at(-1)?.response;
  assert.equal(skippedPostResponse?.skipped, true, "second content VM shares the legacy processed ID from the first VM");
  const skippedPostMessage = sendMessages.filter((message) => message.action === "POST_TWEET"
    && (message.payload as Record<string, unknown>).tweetId === "987654321098765432").at(-1);
  assert.equal((skippedPostMessage?.payload as Record<string, unknown>).replyParentTweetId, "123456789012345678");
  assert.equal(storedSourceContexts.has("987654321098765432"), false, "ordinary POST skip has not stored the source snapshot");
  assert.equal(sendMessages.some((message) => message.action === "POST_TWEET_CONTEXT_ENRICHMENT"), true);
  assert.equal(postedBodies.length, 2);
  assert.equal(postedBodies[1].kind, "source_context_enrichment");
  assert.equal(postedBodies[1].replyParentTweetId, "123456789012345678");
  assert.equal((storage.tibo_pending_source_context_enrichments as Array<{ tweetId: string }>).length, 1);

  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 2, "same failed revision is retained without an immediate duplicate fetch");
  (storage.tibo_pending_source_context_enrichments as Array<{ nextAttemptAt: number }>)[0].nextAttemptAt = 0;
  const restartedWorkerContext = vm.createContext({
    chrome: workerChrome,
    TiboDiagnostics: { appendDiagnosticLog: async () => {}, markSuccessfulScan: async () => {} },
    TiboMonitorScan: loadScanUtils(),
    importScripts() {},
    crypto: (await import("node:crypto")).webcrypto,
    TextEncoder: (await import("node:util")).TextEncoder,
    URL,
    fetch: async (url: string, init: { body?: string }) => {
      if (!url.endsWith("/api/webhook/tibo")) return { ok: true, status: 200, json: async () => ({}) };
      const body = JSON.parse(init.body || "{}") as Record<string, unknown>;
      postedBodies.push(body);
      fetchCount += 1;
      if (body.kind !== "source_context_enrichment" && body.tweetId === delayedTweetId) {
        notifyDelayedPostStarted?.();
        await new Promise<void>((resolve) => { delayedPost.release = resolve; });
      }
      if (body.kind === "source_context_enrichment" && sourceConflict) return { ok: false, status: 409, text: async () => "conflict" };
      if (body.kind === "source_context_enrichment") {
        storedSourceContexts.set(String(body.tweetId), {
          parent: { tweetId: body.replyParentTweetId, tweetUrl: body.replyParentTweetUrl, text: body.replyContextText },
        });
        return { ok: true, status: 200, json: async () => ({ success: true, status: "applied" }) };
      }
      return { ok: true, status: 200, json: async () => ({ success: true }) };
    },
    console,
  });
  vm.runInContext(`${workerSource}\nglobalThis.__retryPendingTweet = retryPendingTweet;`, restartedWorkerContext);
  await (restartedWorkerContext as typeof restartedWorkerContext & { __retryPendingTweet: () => Promise<unknown> }).__retryPendingTweet();
  assert.equal(postedBodies.length, 3);
  assert.equal(postedBodies[2].kind, "source_context_enrichment");
  assert.equal((storedSourceContexts.get("987654321098765432")?.parent as Record<string, unknown>)?.tweetId,
    "123456789012345678", "source-only snapshot is stored before the revision can be acknowledged");
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 3, "acknowledged late enrichment stays deduplicated");
  assert.deepEqual(Array.from(storage.tibo_pending_source_context_enrichments as unknown[]), []);

  const acknowledgedContextMessageCount = sendMessages.filter((message) => message.action === "POST_TWEET_CONTEXT_ENRICHMENT").length;
  const equivalentParent = makeThreadArticle({ id: "123456789012345678", handle: "PARENT_AUTHOR", text: "Late parent evidence", outgoing: true });
  allArticles = makeTimeline(equivalentParent.cell, lateReplyChild.cell).querySelectorAll('article[data-testid="tweet"]');
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(sendMessages.filter((message) => message.action === "POST_TWEET_CONTEXT_ENRICHMENT").length,
    acknowledgedContextMessageCount, "handle case and URL host aliases do not create a new revision");

  sourceConflict = true;
  const conflictingParent = makeThreadArticle({ id: "223456789012345678", handle: "other_parent", text: "Conflicting parent evidence", outgoing: true });
  allArticles = makeTimeline(conflictingParent.cell, lateReplyChild.cell).querySelectorAll('article[data-testid="tweet"]');
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 4, "a distinct parent revision is attempted once");
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 4, "409 conflict is persisted and not retransmitted");

  const thirdParent = makeThreadArticle({ id: "323456789012345678", handle: "third_parent", text: "Third parent evidence", outgoing: true });
  allArticles = makeTimeline(thirdParent.cell, lateReplyChild.cell).querySelectorAll('article[data-testid="tweet"]');
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 5, "third distinct revision is bounded and terminally recorded");
  const fourthParent = makeThreadArticle({ id: "423456789012345678", handle: "fourth_parent", text: "Fourth parent evidence", outgoing: true });
  allArticles = makeTimeline(fourthParent.cell, lateReplyChild.cell).querySelectorAll('article[data-testid="tweet"]');
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 5, "terminal revisions count toward the three-revision cap");

  sourceConflict = false;
  const reversePost = makeThreadArticle({ id: "887654321098765432", handle: "thsottiaux", text: "Reply captured first", incoming: true });
  const reverseParent = makeThreadArticle({ id: "787654321098765432", handle: "reverse_parent", text: "Earlier reply context", outgoing: true });
  allArticles = makeTimeline(reverseParent.cell, reversePost.cell).querySelectorAll('article[data-testid="tweet"]');
  (lateContentContext.window as { location: { href: string; pathname: string } }).location.href = "https://x.com/thsottiaux/with_replies";
  (lateContentContext.window as { location: { href: string; pathname: string } }).location.pathname = "/thsottiaux/with_replies";
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 7, "initial with_replies context must still reach the source-only store");
  assert.equal(postedBodies[5].replyParentTweetId, "787654321098765432", "with_replies first keeps strong context on initial submission");
  assert.equal((storedSourceContexts.get("887654321098765432")?.parent as Record<string, unknown>)?.tweetId,
    "787654321098765432", "HTTP 200 plus worker skip is not acknowledged until the source snapshot is stored");
  const reverseProfileChild = makeThreadArticle({ id: "887654321098765432", handle: "thsottiaux", text: "Reply captured first" });
  allArticles = [reverseProfileChild.article];
  (lateContentContext.window as { location: { href: string; pathname: string } }).location.href = "https://x.com/thsottiaux";
  (lateContentContext.window as { location: { href: string; pathname: string } }).location.pathname = "/thsottiaux";
  lateObserver.callback();
  await Promise.all(scanTasks);
  await Promise.all(workerResponses);
  assert.equal(postedBodies.length, 7, "later profile scan does not resend a legacy processed ID");

  const inFlightTweetId = "667654321098765432";
  let markPostStarted: (() => void) | null = null;
  const postStarted = new Promise<void>((resolve) => { markPostStarted = resolve; });
  notifyDelayedPostStarted = () => markPostStarted?.();
  delayedTweetId = inFlightTweetId;
  const inFlightRoot = makeThreadArticle({ id: inFlightTweetId, handle: "thsottiaux", text: "In-flight root post" });
  allArticles = [inFlightRoot.article];
  lateObserver.callback();
  await Promise.all(scanTasks);
  await postStarted;

  const inFlightParent = makeThreadArticle({ id: "567654321098765432", handle: "inflight_parent", text: "Context arrived in flight", outgoing: true });
  const inFlightReply = makeThreadArticle({ id: inFlightTweetId, handle: "thsottiaux", text: "In-flight root post", incoming: true });
  allArticles = makeTimeline(inFlightParent.cell, inFlightReply.cell).querySelectorAll('article[data-testid="tweet"]');
  (lateContentContext.window as { location: { href: string; pathname: string } }).location.href = "https://x.com/thsottiaux/with_replies";
  (lateContentContext.window as { location: { href: string; pathname: string } }).location.pathname = "/thsottiaux/with_replies";
  lateObserver.callback();
  await Promise.all(scanTasks);
  assert.equal(sendMessages.some((message) => message.action === "POST_TWEET_CONTEXT_ENRICHMENT"
    && (message.payload as Record<string, unknown>).tweetId === inFlightTweetId), false, "late context waits while ordinary post is in flight");

  delayedPost.release();
  await Promise.all(workerResponses);
  await Promise.all(workerResponses);
  assert.equal(sendMessages.some((message) => message.action === "POST_TWEET_CONTEXT_ENRICHMENT"
    && (message.payload as Record<string, unknown>).tweetId === inFlightTweetId), true, "late context is flushed after the post acknowledgement");
  assert.equal(postedBodies.some((body) => body.kind === "source_context_enrichment" && body.tweetId === inFlightTweetId), true);
});
