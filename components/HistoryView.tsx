import Link from "next/link";
import { ExternalLink, History } from "lucide-react";
import {
  isSafeHttpUrl,
} from "@/lib/radar";
import type { HistorySourceKind, Locale, PublicRadarSnapshot } from "@/lib/radar/types";
import { LocalizedDateTime } from "@/components/LocalizedDateTime";
import { ResetHistoryDetails } from "@/components/ResetHistoryDetails";
import { translateDynamic, translateUI } from "@/lib/radar/i18n";
import { DeveloperLink } from "./DeveloperLink";

type HistoryViewProps = {
  data: PublicRadarSnapshot;
  locale: Locale;
};

type HistoryItem = PublicRadarSnapshot["viewModel"]["recentHistory"][number];

function hasPriorSignal(item: HistoryItem) {
  if (!item.signalAt || !item.resetAt) return false;
  const signalTime = new Date(item.signalAt).getTime();
  const resetTime = new Date(item.resetAt).getTime();
  return Number.isFinite(signalTime) && Number.isFinite(resetTime) && signalTime < resetTime;
}

function getMonthLabel(value: string | null | undefined, locale: Locale) {
  if (!value || Number.isNaN(new Date(value).getTime())) {
    return locale === "en" ? "Date unknown" : locale === "zh" ? "日期未知" : "日付不明";
  }

  const language = locale === "en" ? "en-US" : locale === "zh" ? "zh-CN" : "ja-JP";
  return new Intl.DateTimeFormat(language, {
    year: "numeric",
    month: "long",
    timeZone: "Asia/Tokyo",
  }).format(new Date(value));
}

function groupByMonth(items: HistoryItem[], locale: Locale) {
  const groups = new Map<string, { label: string; items: HistoryItem[] }>();
  for (const item of items) {
    const date = item.resetAt ?? item.date ?? null;
    const label = getMonthLabel(date, locale);
    const key = date && !Number.isNaN(new Date(date).getTime())
      ? new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", timeZone: "Asia/Tokyo" }).format(new Date(date))
      : "unknown";
    const group = groups.get(key) ?? { label, items: [] };
    group.items.push(item);
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

function getSourceLabel(sourceKind: HistorySourceKind | undefined, locale: Locale) {
  switch (sourceKind) {
    case "direct_post":
      return translateUI("sourceOriginalPost", locale);
    case "profile":
      return translateUI("sourceProfile", locale);
    case "official_status":
      return translateUI("sourceOfficialStatus", locale);
    default:
      return translateUI("sourceNotRecorded", locale);
  }
}

function HistorySource({ item, locale }: { item: HistoryItem; locale: Locale }) {
  const label = getSourceLabel(item.sourceKind, locale);
  const canLink = Boolean(item.sourceKind && item.sourceKind !== "none" && isSafeHttpUrl(item.source));

  return canLink ? (
    <a
      className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
      href={item.source ?? undefined}
      rel="noreferrer"
      target="_blank"
    >
      {label}
      <ExternalLink className="h-3.5 w-3.5" />
    </a>
  ) : (
    <span className="text-slate-500">{label}</span>
  );
}

function HistoryEventSection({
  title,
  empty,
  items,
  locale,
}: {
  title: string;
  empty: string;
  items: HistoryItem[];
  locale: Locale;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
      <header className="border-b border-slate-100 pb-4">
        <h2 className="text-xl font-semibold text-slate-950">{title}</h2>
      </header>
      <div className="mt-5 space-y-7">
        {groupByMonth(items, locale).map((group) => (
          <div key={group.label}>
            <h3 className="text-sm font-semibold text-teal-800">{group.label}</h3>
            <div className="mt-2 divide-y divide-slate-100">
              {group.items.map((item) => (
                <article
                  className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto]"
                  key={item.key}
                >
                  <div>
                    <h4 className="ui-heading text-lg font-semibold text-slate-950">
                      {getHistoryDisplayTitle(item, locale)}
                    </h4>
                    <ResetHistoryDetails item={item} locale={locale} />
                  </div>

                  <div className="text-sm leading-6 text-slate-700 md:text-right">
                    {hasPriorSignal(item) ? (
                      <p>
                        {item.signalLabel}{locale === "en" ? ": " : "："}<LocalizedDateTime value={item.signalAt} locale={locale} />
                      </p>
                    ) : null}
                    {item.resetAt ? (
                      <p>
                        {item.resetLabel}{locale === "en" ? ": " : "："}<LocalizedDateTime value={item.resetAt} locale={locale} />
                      </p>
                    ) : null}
                    <HistorySource item={item} locale={locale} />
                  </div>
                </article>
              ))}
            </div>
          </div>
        ))}
        {items.length === 0 ? (
          <p className="text-sm leading-6 text-slate-600">{empty}</p>
        ) : null}
      </div>
    </section>
  );
}

function getHistoryDisplayTitle(item: HistoryItem, locale: Locale) {
  const title = translateDynamic(item.title, locale);
  if (item.recordKind !== "reference") {
    return title;
  }

  return locale === "en"
    ? `${title} (reference record)`
    : locale === "zh"
      ? `${title}（参考记录）`
      : `${title}（参考記録）`;
}

export function HistoryView({ data, locale }: HistoryViewProps) {
  const viewModel = data.viewModel;

  const content = {
    ja: {
      category: "Codexリセット履歴",
      pageTitle: "直近のリセット履歴",
      sectionTitle: "リセット履歴",
      description: "Codexの全体リセットと任意リセット配布を、新しい順にまとめています。",
      empty: "履歴データはまだ取得できていません。",
      nav: {
        top: "トップへ戻る",
        about: "Aboutを見る",
        faq: "FAQを見る",
        otherLangHistory: "English history",
      },
      footerText: "リセット履歴を表示しています。",
    },
    en: {
      category: "Codex usage limits reset history",
      pageTitle: "Recent Codex Reset Events",
      sectionTitle: "Reset history",
      description: "Global resets and Banked Reset distributions are listed together in chronological order.",
      empty: "No reset history is available yet.",
      nav: {
        top: "Back to English top",
        about: "About",
        faq: "FAQ",
        otherLangHistory: "Japanese history",
      },
      footerText: "Showing reset history.",
    },
    zh: {
      category: "Codex 重置历史",
      pageTitle: "重置记录历史",
      sectionTitle: "重置记录",
      description: "按时间倒序汇总 Codex 全局重置和手动重置发放记录。",
      empty: "暂无重置历史记录。",
      nav: {
        top: "返回中文首页",
        about: "关于我们",
        faq: "常见问题",
        otherLangHistory: "日本語履歴",
      },
      footerText: "正在显示重置历史。",
    },
  }[locale];

  const visibleItems = viewModel.recentHistory.filter(
    (item) => item.recordKind === "confirmed_global" ||
      item.recordKind === "banked_distribution" ||
      item.recordKind === "reference" ||
      item.recordKind === "regular_completed",
  );

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" lang={locale}>
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-teal-700">
                {content.category}
              </p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
                {content.pageTitle}
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                {content.description}
              </p>
            </div>
            <History className="mt-1 h-7 w-7 shrink-0 text-slate-700" />
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <Link
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
              href={locale === "ja" ? "/" : locale === "en" ? "/en" : "/zh"}
            >
              {content.nav.top}
            </Link>
            <Link
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
              href={locale === "ja" ? "/about" : locale === "en" ? "/en/about" : "/zh/about"}
            >
              {translateUI("about", locale)}
            </Link>
            <Link
              className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm transition hover:border-teal-200 hover:text-teal-800"
              href={locale === "ja" ? "/faq" : locale === "en" ? "/en/faq" : "/zh/faq"}
            >
              {translateUI("faq", locale)}
            </Link>
          </div>
        </header>

        <HistoryEventSection
          title={content.sectionTitle}
          empty={content.empty}
          items={visibleItems}
          locale={locale}
        />

        <footer className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-950 p-5 text-sm text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap gap-3 text-slate-300">
            <Link className="underline-offset-4 hover:underline" href={locale === "ja" ? "/" : locale === "en" ? "/en" : "/zh"}>
              {content.nav.top}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={locale === "ja" ? "/about" : locale === "en" ? "/en/about" : "/zh/about"}>
              {translateUI("about", locale)}
            </Link>
            <Link className="underline-offset-4 hover:underline" href={locale === "ja" ? "/faq" : locale === "en" ? "/en/faq" : "/zh/faq"}>
              {translateUI("faq", locale)}
            </Link>
            {locale === "ja" ? (
              <>
                <Link className="underline-offset-4 hover:underline" href="/en/history">
                  English history
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/zh/history">
                  简体中文历史
                </Link>
              </>
            ) : locale === "en" ? (
              <>
                <Link className="underline-offset-4 hover:underline" href="/history">
                  日本語履歴
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/zh/history">
                  简体中文历史
                </Link>
              </>
            ) : (
              <>
                <Link className="underline-offset-4 hover:underline" href="/history">
                  日本語履歴
                </Link>
                <Link className="underline-offset-4 hover:underline" href="/en/history">
                  English history
                </Link>
              </>
            )}
            <DeveloperLink
              locale={locale}
              className="text-slate-300 hover:text-white"
            />
          </nav>
          <p className="font-semibold text-slate-300">{content.footerText}</p>
        </footer>
      </div>
    </main>
  );
}
