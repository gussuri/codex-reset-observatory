const BASE_URL = "https://codex-reset-observatory.vercel.app";
const LAST_MODIFIED = "2026-06-18T00:00:00+09:00";

type SitemapRoute = {
  path: string;
  changefreq: "hourly" | "daily" | "monthly";
  priority: string;
};

const ROUTES: Array<SitemapRoute> = [
  { path: "/", changefreq: "hourly", priority: "1.0" },
  { path: "/about", changefreq: "monthly", priority: "0.5" },
  { path: "/faq", changefreq: "monthly", priority: "0.5" },
  { path: "/history", changefreq: "daily", priority: "0.8" },
  { path: "/en", changefreq: "hourly", priority: "0.8" },
  { path: "/en/about", changefreq: "monthly", priority: "0.5" },
  { path: "/en/faq", changefreq: "monthly", priority: "0.5" },
  { path: "/en/history", changefreq: "daily", priority: "0.8" },
];

export function GET() {
  return new Response(buildSitemapXml(), {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}

function buildSitemapXml() {
  const urls = ROUTES.map((route) => {
    const alternates = getAlternates(route.path);

    return [
      "  <url>",
      `    <loc>${escapeXml(`${BASE_URL}${route.path}`)}</loc>`,
      `    <lastmod>${LAST_MODIFIED}</lastmod>`,
      `    <changefreq>${route.changefreq}</changefreq>`,
      `    <priority>${route.priority}</priority>`,
      `    <xhtml:link rel="alternate" hreflang="ja" href="${escapeXml(
        `${BASE_URL}${alternates.ja}`,
      )}" />`,
      `    <xhtml:link rel="alternate" hreflang="en" href="${escapeXml(
        `${BASE_URL}${alternates.en}`,
      )}" />`,
      "  </url>",
    ].join("\n");
  }).join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    urls,
    "</urlset>",
    "",
  ].join("\n");
}

function getAlternates(path: string) {
  if (path === "/" || path === "/en") {
    return { ja: "/", en: "/en" };
  }

  if (path.startsWith("/en/")) {
    return { ja: path.replace(/^\/en/, ""), en: path };
  }

  return { ja: path, en: `/en${path}` };
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
