import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import React from "react";

import { fetchRadarPageData } from "./radarFetch";
import { formatElapsedResetDuration, probabilityToPercent } from "./radar/helpers";
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

  const generatedAt = snapshot.dataHealth.generatedAt || snapshot.checkedAt;
  const generatedTime = Date.parse(generatedAt);
  const resetTime = snapshot.lastRandomResetAt ? Date.parse(snapshot.lastRandomResetAt) : Number.NaN;
  const elapsed = Number.isFinite(generatedTime) && Number.isFinite(resetTime) && generatedTime >= resetTime
    ? formatElapsedResetDuration(generatedTime - resetTime, locale)
    : copy.unknownValue;

  return {
    copy,
    expectation: snapshot.viewModel.expectation || copy.unknownValue,
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

function StatusPill({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, gap: 8 }}>
      <div style={{ color: "#64748b", display: "flex", fontSize: 21 }}>{label}</div>
      <div style={{ color: value === "No" || value === "なし" || value === "无" ? "#334155" : "#b45309", display: "flex", fontSize: 28, fontWeight: 700 }}>
        {value}
      </div>
    </div>
  );
}

function RadarOgImage({ model }: { model: RadarOgImageModel }) {
  const { copy } = model;
  const expectationColor = model.expectation.includes("低") || model.expectation.includes("low") || model.expectation.includes("较低")
    ? "#15803d"
    : model.expectation.includes("高") || model.expectation.includes("high") || model.expectation.includes("较高")
      ? "#b45309"
      : "#1d4ed8";

  return (
    <div style={{ background: "#ffffff", color: "#0f172a", display: "flex", flexDirection: "column", fontFamily: "NotoSansJP", height: "100%", padding: "52px 60px 42px", width: "100%" }}>
      <div style={{ display: "flex", flexDirection: "column" }}>
        <div style={{ display: "flex", fontSize: 39, fontWeight: 700 }}>{copy.title}</div>
        <div style={{ color: "#475569", display: "flex", fontSize: 23, marginTop: 9 }}>{copy.subtitle}</div>
      </div>

      <div style={{ display: "flex", gap: 18, marginTop: 34 }}>
        <div style={{ border: "2px solid #dbeafe", borderRadius: 18, display: "flex", flexDirection: "column", justifyContent: "center", padding: "20px 28px", width: 350 }}>
          <div style={{ color: "#475569", display: "flex", fontSize: 20 }}>{copy.expectation}</div>
          <div style={{ color: expectationColor, display: "flex", fontSize: 48, fontWeight: 700, marginTop: 8 }}>{model.expectation}</div>
        </div>
        <div style={{ border: "2px solid #e2e8f0", borderRadius: 18, display: "flex", flex: 1, gap: 38, padding: "20px 28px" }}>
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: "#64748b", display: "flex", fontSize: 20 }}>{copy.within24h}</div>
            <div style={{ color: "#0f172a", display: "flex", fontSize: 51, fontWeight: 700, marginTop: 7 }}>{model.probability24h}</div>
          </div>
          <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>
            <div style={{ color: "#64748b", display: "flex", fontSize: 20 }}>{copy.within48h}</div>
            <div style={{ color: "#0f172a", display: "flex", fontSize: 51, fontWeight: 700, marginTop: 7 }}>{model.probability48h}</div>
          </div>
        </div>
      </div>

      <div style={{ borderBottom: "1px solid #e2e8f0", borderTop: "1px solid #e2e8f0", display: "flex", gap: 26, marginTop: 28, padding: "17px 4px" }}>
        <StatusPill label={copy.officialNotice} value={model.officialNotice} />
        <StatusPill label={copy.teaser} value={model.teaser} />
        <StatusPill label={copy.incident} value={model.incident} />
      </div>

      <div style={{ alignItems: "flex-end", display: "flex", justifyContent: "space-between", marginTop: "auto" }}>
        <div style={{ color: "#334155", display: "flex", flexDirection: "column", fontSize: 23, gap: 5 }}>
          <div style={{ display: "flex" }}><span style={{ color: "#64748b", fontSize: 19 }}>{copy.elapsed}: </span>{model.elapsed}</div>
        </div>
        <div style={{ color: "#64748b", display: "flex", fontSize: 18 }}><span>{`${copy.updated} ${model.updated}`}</span></div>
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
