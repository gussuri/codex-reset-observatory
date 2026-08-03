import Link from "next/link";
import { ExternalLink, History, Info } from "lucide-react";
import {
  isSafeHttpUrl,
} from "@/lib/radar";
import type { Locale, PublicRadarSnapshot } from "@/lib/radar/types";
import { LocalizedDateTime } from "@/components/LocalizedDateTime";
import { ResetHistoryDetails } from "@/components/ResetHistoryDetails";
import { translateUI } from "@/lib/radar/i18n";
import { DeveloperLink } from "./DeveloperLink";

type HistoryViewProps = {
  data: PublicRadarSnapshot;
  locale: Locale;
};

export function HistoryView({ data, locale }: HistoryViewProps) {
  const viewModel = data.viewModel;

  const content = {
    ja: {
      category: "Codexリセット履歴",
      title: "リセット履歴",
      description: "詫び・ご祝儀・予告付き臨時リセットに加えて、1週間サイクルの定期リセットや任意リセット配布も表示します。",
      empty: "履歴データはまだ取得できていません。",
      cardTitle: "そのほかのリセット",
      cardHeader: "任意リセット・友達紹介リセット",
      cardParagraph1: "アカウントごとに付与・消費される個人別のリセットです。任意リセットを使ったアカウントでは、次回定期リセット日がこちらに表示している日付とずれます。",
      cardParagraph2: "配布された任意リセットには1か月以内の期限があります。配布記録は履歴に残しますが、全体向けのリセットではないため、最新リセットやランダムリセット期待度の計算には含めていません。",
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
      title: "Recent Codex Reset Events",
      description: "Review recent Codex usage limits reset signals, weekly reset events, Banked Reset credits, and forecast changes over time.",
      empty: "No reset history is available yet.",
      cardTitle: "Manual and referral resets",
      cardHeader: "Account-specific reset credits",
      cardParagraph1: "Banked Reset credits (manual resets) and referral resets are account-specific. They may appear in history as distribution records, but they are not counted as global reset events.",
      cardParagraph2: "A Banked Reset credit expires within one month. If you use one, your next weekly reset date will differ from the shared reference date shown on this site.",
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
      title: "重置记录历史",
      description: "显示故障补偿重置、庆祝重置、带预告的临时重置、每周循环的定期重置以及手动重置额度的发放记录。",
      empty: "暂无重置历史记录。",
      cardTitle: "其他重置方式",
      cardHeader: "手动重置与推荐奖励重置",
      cardParagraph1: "这些重置是针对特定账号的个人化重置。手动重置额度的发放可能会作为记录显示在历史记录中，但它们并不被视为全局重置事件。",
      cardParagraph2: "手动重置额度具有一个月的使用限期。如果您使用了它，下一次定期重置的时间将与本站显示的公共参考日期产生偏差。",
      nav: {
        top: "返回中文首页",
        about: "关于我们",
        faq: "常见问题",
        otherLangHistory: "日本語履歴",
      },
      footerText: "正在显示重置历史。",
    },
  }[locale];

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
                {content.title}
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

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="divide-y divide-slate-100">
            {viewModel.recentHistory.length > 0 ? (
              viewModel.recentHistory.map((item) => (
                <article
                  className="grid gap-4 py-5 first:pt-0 last:pb-0 md:grid-cols-[1fr_auto]"
                  key={item.key}
                >
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="ui-heading text-lg font-semibold text-slate-950">
                        {item.title}
                      </h2>
                    </div>
                    <ResetHistoryDetails item={item} locale={locale} />
                  </div>

                  <div className="text-sm leading-6 text-slate-700 md:text-right">
                    {item.signalLabel ? (
                      <p>
                        {item.signalLabel}: <LocalizedDateTime value={item.signalAt} locale={locale} />
                      </p>
                    ) : null}
                    {item.resetAt || item.resetLabel ? (
                      <p>
                        {item.resetLabel}: <LocalizedDateTime value={item.resetAt} locale={locale} />
                      </p>
                    ) : null}
                    {isSafeHttpUrl(item.source) ? (
                      <a
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
                        href={item.source ?? undefined}
                        rel="noreferrer"
                        target="_blank"
                      >
                        {translateUI("source", locale)}
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-slate-600">
                {content.empty}
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-sky-200 bg-sky-50/90 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div>
              <p className="text-sm font-medium text-sky-700">
                {content.cardTitle}
              </p>
              <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">
                {content.cardHeader}
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-700">
                {content.cardParagraph1}
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                {content.cardParagraph2}
              </p>
            </div>
          </div>
        </section>

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
