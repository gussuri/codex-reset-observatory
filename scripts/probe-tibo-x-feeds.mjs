const USERNAME = "thsottiaux";
const REQUEST_TIMEOUT_MS = 12_000;

const CANDIDATES = [
  {
    id: "rsshub-app",
    kind: "rsshub",
    url: `https://rsshub.app/twitter/user/${USERNAME}`,
  },
  {
    id: "rsshub-rssforever",
    kind: "rsshub",
    url: `https://rsshub.rssforever.com/twitter/user/${USERNAME}`,
  },
  {
    id: "nitter-xcancel",
    kind: "nitter",
    url: `https://xcancel.com/${USERNAME}/rss`,
  },
  {
    id: "nitter-xcancel-search",
    kind: "nitter",
    url: `https://xcancel.com/search/rss?f=tweets&q=from%3A${USERNAME}`,
  },
  {
    id: "nitter-poast",
    kind: "nitter",
    url: `https://nitter.poast.org/${USERNAME}/rss`,
  },
  {
    id: "nitter-poast-search",
    kind: "nitter",
    url: `https://nitter.poast.org/search/rss?f=tweets&q=from%3A${USERNAME}`,
  },
  {
    id: "nitter-privacyredirect",
    kind: "nitter",
    url: `https://nitter.privacyredirect.com/${USERNAME}/rss`,
  },
  {
    id: "nitter-tiekoetter",
    kind: "nitter",
    url: `https://nitter.tiekoetter.com/${USERNAME}/rss`,
  },
  {
    id: "nitter-net",
    kind: "nitter",
    url: `https://nitter.net/${USERNAME}/rss`,
  },
  {
    id: "nitter-space",
    kind: "nitter",
    url: `https://nitter.space/${USERNAME}/rss`,
  },
  {
    id: "nitter-lightbrd",
    kind: "nitter",
    url: `https://lightbrd.com/${USERNAME}/rss`,
  },
  {
    id: "nitter-privacydev",
    kind: "nitter",
    url: `https://nitter.privacydev.net/${USERNAME}/rss`,
  },
  {
    id: "openrss-twitter",
    kind: "openrss",
    url: `https://openrss.org/twitter.com/${USERNAME}`,
  },
  {
    id: "openrss-x",
    kind: "openrss",
    url: `https://openrss.org/x.com/${USERNAME}`,
  },
  {
    id: "twitrss-user",
    kind: "twitrss",
    url: `https://twitrss.me/twitter_user_to_rss/?user=${USERNAME}`,
  },
  {
    id: "x-syndication-profile",
    kind: "x-syndication",
    url: `https://syndication.twitter.com/srv/timeline-profile/screen-name/${USERNAME}`,
  },
  {
    id: "jina-x-profile",
    kind: "jina-reader",
    url: `https://r.jina.ai/http://x.com/${USERNAME}`,
  },
  {
    id: "jina-twitter-profile",
    kind: "jina-reader",
    url: `https://r.jina.ai/http://twitter.com/${USERNAME}`,
  },
];

const RESET_NOTICE_KEYWORDS = [
  "limits reset",
  "usage limits",
  "within 24 hours",
];
const BROAD_RESET_KEYWORD = "reset";
const RESET_NEGATION_PATTERNS = [
  /no reset/,
  /not .*reset/,
  /without .*reset/,
];

const INCIDENT_HINT_KEYWORDS = [
  "capacity",
  "rate limit",
  "high error rate",
  "reached capacity",
  "limit anomaly",
  "errors",
];

const FIXTURE_POSTS = [
  "Please allow up to 24 hours for Codex usage limits reset.",
  "We are seeing a high error rate and model reached capacity errors.",
  "General Codex update with no reset signal.",
];

async function main() {
  const results = [];

  for (const candidate of CANDIDATES) {
    results.push(await probe(candidate));
  }

  const output = { checkedAt: new Date().toISOString(), results };

  if (process.argv.includes("--fixtures")) {
    output.classificationFixtures = FIXTURE_POSTS.map((text) => ({
      text,
      classification: classifyPost({ text }),
    }));
  }

  console.log(JSON.stringify(output, null, 2));
}

async function probe(candidate) {
  const startedAt = Date.now();

  try {
    const response = await fetchWithTimeout(candidate.url);
    const body = await response.text();
    const entries = parseFeed(body).slice(0, 10).map((post) => ({
      ...post,
      classification: classifyPost(post),
    }));
    const posts = entries.filter(hasRequiredFields);
    const error = response.ok && posts.length === 0
      ? summarizeUnusableResponse(body, entries)
      : response.ok
        ? null
        : truncate(body);

    return {
      ...candidate,
      ok: response.ok && posts.length > 0,
      status: response.status,
      contentType: response.headers.get("content-type"),
      durationMs: Date.now() - startedAt,
      feedEntryCount: entries.length,
      postCount: posts.length,
      latestPost: posts[0] ?? null,
      resetNoticeCandidates: posts.filter(
        (post) => post.classification === "official_notice",
      ).length,
      incidentHintCandidates: posts.filter(
        (post) => post.classification === "official_incident_hint",
      ).length,
      error,
    };
  } catch (error) {
    return {
      ...candidate,
      ok: false,
      status: null,
      contentType: null,
      durationMs: Date.now() - startedAt,
      feedEntryCount: 0,
      postCount: 0,
      latestPost: null,
      resetNoticeCandidates: 0,
      incidentHintCandidates: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function fetchWithTimeout(url) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    return await fetch(url, {
      headers: {
        accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
        "user-agent": "codex-reset-observatory-feed-probe/0.1",
      },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

function parseFeed(xml) {
  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) =>
    parseRssItem(match[0]),
  );

  if (items.length > 0) {
    return items;
  }

  return [...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) =>
    parseAtomEntry(match[0]),
  );
}

function parseRssItem(itemXml) {
  const title = readTag(itemXml, "title");
  const description = readTag(itemXml, "description");
  const link = readTag(itemXml, "link") ?? readTag(itemXml, "guid");
  const publishedAt = readTag(itemXml, "pubDate") ?? readTag(itemXml, "dc:date");

  return normalizePost({ title, description, link, publishedAt });
}

function parseAtomEntry(entryXml) {
  const title = readTag(entryXml, "title");
  const description = readTag(entryXml, "content") ?? readTag(entryXml, "summary");
  const link = readAtomLink(entryXml);
  const publishedAt = readTag(entryXml, "published") ?? readTag(entryXml, "updated");

  return normalizePost({ title, description, link, publishedAt });
}

function normalizePost({ title, description, link, publishedAt }) {
  const text = decodeEntities(stripTags(description ?? title ?? "")).trim();

  return {
    text: truncate(text, 500),
    publishedAt: normalizeDate(publishedAt),
    url: normalizeUrl(link),
  };
}

function classifyPost(post) {
  const text = post.text.toLowerCase();

  const hasResetNotice =
    RESET_NOTICE_KEYWORDS.some((keyword) => text.includes(keyword)) ||
    (text.includes(BROAD_RESET_KEYWORD) &&
      !RESET_NEGATION_PATTERNS.some((pattern) => pattern.test(text)));

  if (hasResetNotice) {
    return "official_notice";
  }

  if (INCIDENT_HINT_KEYWORDS.some((keyword) => text.includes(keyword))) {
    return "official_incident_hint";
  }

  return "none";
}

function hasRequiredFields(post) {
  return Boolean(
    post.text &&
      post.publishedAt &&
      post.url &&
      /\/status\/\d+/.test(post.url) &&
      !post.text.toLowerCase().includes("rss reader not yet whitelist"),
  );
}

function readTag(xml, tagName) {
  const escapedName = tagName.replace(":", "\\:");
  const match = xml.match(new RegExp(`<${escapedName}[^>]*>([\\s\\S]*?)<\\/${escapedName}>`, "i"));
  return match ? decodeEntities(match[1].trim()) : null;
}

function readAtomLink(xml) {
  const hrefMatch = xml.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
  return hrefMatch ? decodeEntities(hrefMatch[1].trim()) : readTag(xml, "link");
}

function stripTags(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function decodeEntities(value) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, decimal) =>
      String.fromCodePoint(Number(decimal)),
    );
}

function normalizeDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toISOString();
}

function normalizeUrl(value) {
  if (!value) {
    return null;
  }

  return value.replace("nitter.net", "x.com").replace(/https:\/\/[^/]+\/([^/]+)\/status\//, "https://x.com/$1/status/");
}

function summarizeUnusableResponse(body, entries) {
  if (entries.length > 0) {
    return `No usable tweet entries found. First entry: ${truncate(entries[0].text)}`;
  }

  return `No RSS/Atom entries found. Body preview: ${truncate(body)}`;
}

function truncate(value, maxLength = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
