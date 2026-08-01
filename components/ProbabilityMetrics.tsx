import React from "react";
import { probabilityToPercent } from "@/lib/radar";
import type { Locale } from "@/lib/radar/types";
import { translateUI } from "@/lib/radar/i18n";

export function ProbabilityMetrics({
  locale,
  probability24h,
  probability48h,
}: {
  locale: Locale;
  probability24h: number | undefined;
  probability48h: number | undefined;
}) {
  return (
    <dl className="mt-5 grid grid-cols-2 gap-3">
      <Metric
        label={translateUI("within24h", locale)}
        locale={locale}
        probability={probability24h}
        value={probabilityToPercent(probability24h, locale)}
      />
      <Metric
        label={translateUI("within48h", locale)}
        locale={locale}
        probability={probability48h}
        value={probabilityToPercent(probability48h, locale)}
      />
    </dl>
  );
}

function Metric({
  label,
  locale,
  probability,
  value,
}: {
  label: string;
  locale: Locale;
  probability: number | undefined;
  value: string;
}) {
  const tone = getProbabilityTone(probability);
  const percent = getProbabilityPercent(probability);
  const isKnown = percent !== undefined;

  return (
    <div className={`rounded-lg border p-4 ${tone.card}`}>
      <dt className={`text-sm font-medium ${tone.label}`}>{label}</dt>
      <dd className={`mt-2 text-3xl font-semibold ${tone.value}`}>{value}</dd>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/75">
        <div
          aria-label={label}
          aria-valuemax={100}
          aria-valuemin={0}
          {...(isKnown
            ? { "aria-valuenow": percent }
            : { "aria-valuetext": translateUI("unknownProbability", locale) })}
          className={`h-full rounded-full ${tone.bar}`}
          role="progressbar"
          style={{ width: getProbabilityBarWidth(probability) }}
        />
      </div>
    </div>
  );
}

function getProbabilityTone(probability: number | undefined) {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return {
      bar: "bg-slate-400",
      card: "border-slate-200 bg-slate-50",
      label: "text-slate-500",
      value: "text-slate-950",
    };
  }

  if (probability <= 0.33) {
    return {
      bar: "bg-sky-500",
      card: "border-sky-200 bg-sky-50",
      label: "text-sky-700",
      value: "text-sky-950",
    };
  }

  if (probability <= 0.66) {
    return {
      bar: "bg-orange-500",
      card: "border-orange-200 bg-orange-50",
      label: "text-orange-700",
      value: "text-orange-950",
    };
  }

  return {
    bar: "bg-rose-500",
    card: "border-rose-200 bg-rose-50",
    label: "text-rose-700",
    value: "text-rose-950",
  };
}

function getProbabilityPercent(probability: number | undefined) {
  if (typeof probability !== "number" || Number.isNaN(probability)) {
    return undefined;
  }

  return Math.min(100, Math.max(0, Math.round(probability * 100)));
}

function getProbabilityBarWidth(probability: number | undefined) {
  const percent = getProbabilityPercent(probability);
  return percent === undefined ? "0%" : `${percent}%`;
}
