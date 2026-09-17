import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import React from "react";

import { fetchRadarPageData } from "./radarFetch";
import { formatElapsedResetDuration, getExpectationKey, probabilityToPercent } from "./radar/helpers";
import type { Locale, PublicRadarSnapshot } from "./radar/types";

export const RADAR_OG_IMAGE_SIZE = { width: 1200, height: 630 } as const;
const OG_CACHE_CONTROL = "public, max-age=0, s-maxage=600, stale-while-revalidate=300";
const OG_FONT_URL =
  "https://raw.githubusercontent.com/googlefonts/noto-cjk/Sans2.004/Sans/SubsetOTF/JP/NotoSansJP-Regular.otf";

type RadarOgCopy = {
  title: string;
  subtitle: string;
  expectation: string;
  within24h: string;
  within48h: string;
  officialNotice: string;
  teaser: string;
  incident: string;
  elapsed: string;
  updated: string;
  yes: string;
  no: string;
  unknown: string;
  unknownValue: string;
};

export type RadarOgImageModel = {
  copy: RadarOgCopy;
  expectation: string;
  expectationTone: "low" | "medium" | "high" | "very_high";
  probability24h: string;
  probability48h: string;
  officialNotice: string;
  teaser: string;
  incident: string;
  elapsed: string;
  updated: string;
};

function getCopy(locale: Locale): RadarOgCopy {
  if (locale === "en") {
    return {
      title: "Codex Reset Observatory",
      subtitle: "Codex reset forecasts, latest updates & history",
      expectation: "Random reset tendency",
      within24h: "Within 24 hours",
      within48h: "Within 48 hours",
      officialNotice: "Official notice",
      teaser: "Teaser",
      incident: "Incident",
      elapsed: "Since last random reset",
      updated: "Updated",
      yes: "Yes",
      no: "No",
      unknown: "Unknown",
      unknownValue: "Unknown",
    };
  }

  if (locale === "zh") {
    return {
      title: "Codex 重置观测站",
      subtitle: "Codex 重置预测、最新信息与历史",
      expectation: "随机重置倾向",
      within24h: "未来24小时",
      within48h: "未来48小时",
      officialNotice: "官方预告",
      teaser: "暗示",
      incident: "故障",
      elapsed: "距上次随机重置",
      updated: "更新",
      yes: "有",
      no: "无",
      unknown: "未知",
      unknownValue: "未知",
    };
  }

  return {
    title: "Codexリセット観測所",
    subtitle: "Codexのリセット予測・最新情報・履歴",
    expectation: "ランダムリセット期待度",
    within24h: "24時間以内",
    within48h: "48時間以内",
    officialNotice: "公式予告",
    teaser: "匂わせ",
    incident: "障害",
    elapsed: "前回から",
    updated: "更新",
    yes: "あり",
    no: "なし",
    unknown: "不明",
    unknownValue: "不明",
  };
}

function formatJstTimestamp(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return null;

  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(value));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}/${values.month}/${values.day} ${values.hour}:${values.minute} JST`;
}

function toProbability(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100
    ? value
    : null;
}

function statusLabel(active: boolean, copy: RadarOgCopy) {
  return active ? copy.yes : copy.no;
}

/**
 * Builds the card from the same public snapshot used by the homepage. This is
 * intentionally a presentation projection; it does not calculate probability
 * or infer a new signal state.
 */
export function buildRadarOgImageModel(
  snapshot: PublicRadarSnapshot,
  locale: Locale,
): RadarOgImageModel | null {
  if (snapshot.dataHealth.overall !== "ok") return null;

  const copy = getCopy(locale);
  const probability24h = toProbability(snapshot.viewModel.probability24h);
  const probability48h = toProbability(snapshot.viewModel.probability48h);
  if (probability24h === null || probability48h === null) return null;
  const expectationTone = getExpectationKey({ p24h: probability24h, p48h: probability48h });
  if (expectationTone === "unknown") return null;

  const generatedAt = snapshot.dataHealth.generatedAt || snapshot.checkedAt;
  const generatedTime = Date.parse(generatedAt);
  const resetTime = snapshot.lastRandomResetAt ? Date.parse(snapshot.lastRandomResetAt) : Number.NaN;
  const elapsed = Number.isFinite(generatedTime) && Number.isFinite(resetTime) && generatedTime >= resetTime
    ? formatElapsedResetDuration(generatedTime - resetTime, locale)
    : copy.unknownValue;

  return {
    copy,
    expectation: snapshot.viewModel.expectation || copy.unknownValue,
    expectationTone,
    probability24h: probabilityToPercent(probability24h, locale),
    probability48h: probabilityToPercent(probability48h, locale),
    officialNotice: statusLabel(
      snapshot.viewModel.activeWindow.active && snapshot.viewModel.activeWindow.kind === "official",
      copy,
    ),
    teaser: statusLabel(
      snapshot.resetTeaserStatus === "strong" || snapshot.resetTeaserStatus === "weak",
      copy,
    ),
    incident: statusLabel(snapshot.viewModel.codexOperationalStatus === "active", copy),
    elapsed,
    updated: formatJstTimestamp(generatedAt) ?? copy.unknownValue,
  };
}

let ogFontPromise: Promise<ArrayBuffer> | null = null;

async function loadOgFont() {
  ogFontPromise ??= fetch(OG_FONT_URL, { next: { revalidate: 86_400 } }).then(async (response) => {
    if (!response.ok) throw new Error(`og_font_fetch_${response.status}`);
    return response.arrayBuffer();
  });
  return ogFontPromise;
}

async function staticFallbackResponse() {
  const fallback = await readFile(join(process.cwd(), "public", "og-image.png"));
  return new Response(fallback, {
    headers: {
      "Cache-Control": OG_CACHE_CONTROL,
      "Content-Type": "image/png",
    },
  });
}

function StatusPill({ label, value, inactiveValue }: { label: string; value: string; inactiveValue: string }) {
  const isActive = value !== inactiveValue;
  const valueColor = isActive ? "#b45309" : "#0f766e";

  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
      <div style={{ alignItems: "center", display: "flex", gap: 10 }}>
        <div style={{ background: isActive ? "#f59e0b" : "#14b8a6", borderRadius: 6, display: "flex", height: 12, width: 12 }} />
        <div style={{ color: "#64748b", display: "flex", fontSize: 21 }}>{label}</div>
      </div>
      <div style={{ color: valueColor, display: "flex", fontSize: 28, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function RadarOgImage({ model }: { model: RadarOgImageModel }) {
  const { copy } = model;
  const expectationTone = {
    low: {
      background: "rgba(240, 253, 250, 0.88)",
      border: "rgba(20, 184, 166, 0.42)",
      color: "#0f766e",
    },
    medium: {
      background: "rgba(255, 247, 237, 0.88)",
      border: "rgba(245, 158, 11, 0.42)",
      color: "#b45309",
    },
    high: {
      background: "rgba(255, 241, 242, 0.88)",
      border: "rgba(244, 63, 94, 0.35)",
      color: "#be123c",
    },
    very_high: {
      background: "rgba(255, 241, 242, 0.92)",
      border: "rgba(244, 63, 94, 0.42)",
      color: "#be123c",
    },
  }[model.expectationTone];

  return (
    <div style={{ background: "radial-gradient(circle at 18% 12%, rgba(20, 184, 166, 0.2), transparent 34%), radial-gradient(circle at 84% 4%, rgba(245, 158, 11, 0.16), transparent 30%), linear-gradient(135deg, #f8fafc 0%, #eef2f7 52%, #f7f7f0 100%)", color: "#0f172a", display: "flex", flexDirection: "column", fontFamily: "NotoSansJP", height: "100%", overflow: "hidden", padding: "52px 60px 42px", position: "relative", width: "100%" }}>
      <div style={{ backgroundImage: "linear-gradient(rgba(15, 118, 110, 0.13) 1px, transparent 1px), linear-gradient(90deg, rgba(15, 118, 110, 0.13) 1px, transparent 1px)", backgroundSize: "34px 34px", display: "flex", height: 390, opacity: 0.45, position: "absolute", right: -18, top: -22, width: 520 }} />
      <div style={{ display: "flex", height: 500, opacity: 0.48, position: "absolute", right: -76, top: -126, width: 500 }}>
        <div style={{ border: "2px solid rgba(20, 184, 166, 0.34)", borderRadius: 250, display: "flex", height: 500, position: "absolute", width: 500 }} />
        <div style={{ border: "2px solid rgba(15, 118, 110, 0.24)", borderRadius: 192, display: "flex", height: 384, left: 58, position: "absolute", top: 58, width: 384 }} />
        <div style={{ border: "2px solid rgba(245, 158, 11, 0.24)", borderRadius: 126, display: "flex", height: 252, left: 124, position: "absolute", top: 124, width: 252 }} />
        <div style={{ background: "rgba(20, 184, 166, 0.15)", borderRadius: 22, display: "flex", height: 44, left: 130, position: "absolute", top: 235, transform: "rotate(-38deg)", width: 270 }} />
        <div style={{ background: "#0f766e", borderRadius: 10, display: "flex", height: 20, left: 240, position: "absolute", top: 240, width: 20 }} />
      </div>

      <div style={{ display: "flex", flex: 1, flexDirection: "column", position: "relative" }}>
        <div style={{ display: "flex", flexDirection: "column" }}>
          <div style={{ display: "flex", fontSize: 39, fontWeight: 700 }}>{copy.title}</div>
          <div style={{ color: "#475569", display: "flex", fontSize: 23, marginTop: 9 }}>{copy.subtitle}</div>
        </div>

        <div style={{ display: "flex", gap: 18, marginTop: 34 }}>
          <div style={{ background: expectationTone.background, border: `2px solid ${expectationTone.border}`, borderRadius: 8, boxShadow: "0 10px 26px rgba(15, 23, 42, 0.08)", display: "flex", flexDirection: "column", justifyContent: "center", padding: "20px 28px", width: 350 }}>
            <div style={{ color: "#475569", display: "flex", fontSize: 20 }}>{copy.expectation}</div>
            <div style={{ color: expectationTone.color, display: "flex", fontSize: 48, fontWeight: 700, marginTop: 8 }}>{model.expectation}</div>
          </div>
          <div style={{ background: "rgba(255, 255, 255, 0.82)", border: "2px solid rgba(20, 184, 166, 0.2)", borderRadius: 8, boxShadow: "0 10px 26px rgba(15, 23, 42, 0.08)", display: "flex", flex: 1, gap: 38, padding: "20px 28px" }}>
            <div style={{ borderLeft: "4px solid rgba(20, 184, 166, 0.42)", display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", paddingLeft: 16 }}>
              <div style={{ color: "#475569", display: "flex", fontSize: 20 }}>{copy.within24h}</div>
              <div style={{ color: "#0f172a", display: "flex", fontSize: 51, fontWeight: 700, marginTop: 7 }}>{model.probability24h}</div>
            </div>
            <div style={{ borderLeft: "4px solid rgba(245, 158, 11, 0.42)", display: "flex", flex: 1, flexDirection: "column", justifyContent: "center", paddingLeft: 16 }}>
              <div style={{ color: "#475569", display: "flex", fontSize: 20 }}>{copy.within48h}</div>
              <div style={{ color: "#0f172a", display: "flex", fontSize: 51, fontWeight: 700, marginTop: 7 }}>{model.probability48h}</div>
            </div>
          </div>
        </div>

        <div style={{ background: "rgba(255, 255, 255, 0.48)", borderBottom: "1px solid rgba(15, 118, 110, 0.2)", borderTop: "1px solid rgba(15, 118, 110, 0.2)", display: "flex", gap: 26, marginTop: 28, padding: "17px 4px" }}>
          <StatusPill inactiveValue={copy.no} label={copy.officialNotice} value={model.officialNotice} />
          <StatusPill inactiveValue={copy.no} label={copy.teaser} value={model.teaser} />
          <StatusPill inactiveValue={copy.no} label={copy.incident} value={model.incident} />
        </div>

        <div style={{ alignItems: "flex-end", display: "flex", justifyContent: "space-between", marginTop: "auto" }}>
          <div style={{ color: "#334155", display: "flex", flexDirection: "column", fontSize: 23, gap: 5 }}>
            <div style={{ alignItems: "baseline", display: "flex" }}>
              <span style={{ color: "#64748b", fontSize: 19 }}>{`${copy.elapsed}:`}</span>
              <span style={{ marginLeft: 8 }}>{model.elapsed}</span>
            </div>
          </div>
          <div style={{ color: "#64748b", display: "flex", fontSize: 18 }}><span>{`${copy.updated} ${model.updated}`}</span></div>
        </div>
      </div>
    </div>
  );
}

export async function renderRadarOgImageModel(model: RadarOgImageModel) {
  const fontData = await loadOgFont();
  return new ImageResponse(<RadarOgImage model={model} />, {
    ...RADAR_OG_IMAGE_SIZE,
    headers: { "Cache-Control": OG_CACHE_CONTROL },
    fonts: [{ name: "NotoSansJP", data: fontData, weight: 400, style: "normal" }],
  });
}

export async function renderRadarOgImage(locale: Locale) {
  try {
    const pageData = await fetchRadarPageData(locale, {
      limitHistory: true,
      includeHeatmap: false,
    });
    const model = buildRadarOgImageModel(pageData.initialData, locale);
    if (!model) return staticFallbackResponse();

    return await renderRadarOgImageModel(model);
  } catch (error) {
    console.error("Dynamic radar OG image failed; using static fallback", {
      locale,
      error: error instanceof Error ? error.message : "unknown_error",
    });
    return staticFallbackResponse();
  }
}
