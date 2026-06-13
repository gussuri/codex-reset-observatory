import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink, History, Info } from "lucide-react";
import {
  SOURCE_SITE_URL,
  SOURCE_SITE_LABEL,
  formatDateTime,
  getRadarViewModel,
  isSafeHttpUrl,
} from "@/lib/radar";
import { fetchCurrentRadarData } from "@/lib/radarFetch";

export const metadata: Metadata = {
  title: "リセット履歴",
  description:
    "Codexの臨時リセット、補償リセット、ご祝儀リセット、公式予告、1週間サイクルの定期リセット、個人別リセットの扱いを日本語で確認できます。",
};

export const revalidate = 300;

export default async function HistoryPage() {
  const data = await fetchCurrentRadarData({ revalidate });
  const viewModel = getRadarViewModel(data);

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <div className="flex items-start justify-between gap-4">
            <div>
              <p className="text-sm font-medium text-teal-700">
                Codexリセット履歴
              </p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
                リセット履歴
              </h1>
              <p className="mt-3 max-w-3xl text-sm leading-6 text-slate-600">
                独自保存した詫び・ご祝儀・予告付き臨時リセットに加えて、1週間サイクルの定期リセットも表示します。
              </p>
            </div>
            <History className="mt-1 h-7 w-7 shrink-0 text-slate-700" />
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
                      <span className="rounded-md bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-700">
                        {item.resetType}
                      </span>
                      <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
                        {item.status}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-6 text-slate-600">
                      対象プラン：{item.scope}
                      <span className="mx-2 hidden sm:inline">/</span>
                      <span className="block sm:inline">
                        予告から実施まで：{item.windowLength}
                      </span>
                    </p>
                  </div>

                  <div className="text-sm leading-6 text-slate-700 md:text-right">
                    {item.signalLabel ? (
                      <p>
                        {item.signalLabel}：{formatDateTime(item.signalAt)}
                      </p>
                    ) : null}
                    <p>
                      {item.resetLabel}：{formatDateTime(item.resetAt)}
                    </p>
                    {isSafeHttpUrl(item.source) ? (
                      <a
                        className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
                        href={item.source ?? undefined}
                        rel="noreferrer"
                        target="_blank"
                      >
                        ソース
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    ) : null}
                  </div>
                </article>
              ))
            ) : (
              <p className="text-sm leading-6 text-slate-600">
                履歴データはまだ取得できていません。
              </p>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-sky-200 bg-sky-50/90 p-5 shadow-sm">
          <div className="flex items-start gap-3">
            <Info className="mt-0.5 h-5 w-5 shrink-0 text-sky-700" />
            <div>
              <p className="text-sm font-medium text-sky-700">
                そのほかのリセット
              </p>
              <h2 className="mt-1 text-xl font-semibold leading-tight text-slate-950">
                任意リセット・友達紹介リセット
              </h2>
              <p className="mt-3 text-sm leading-6 text-slate-700">
                アカウントごとに付与・消費される個人別のリセットです。利用すると、そのアカウントの定期リセット時刻がずれる可能性があります。
              </p>
              <p className="mt-2 text-sm leading-6 text-slate-700">
                全体向けのリセットではないため、このページの直近履歴、最新リセット、ランダムリセット期待度の計算には含めていません。
              </p>
            </div>
          </div>
        </section>

        <footer className="flex flex-col gap-3 rounded-lg border border-slate-200 bg-slate-950 p-5 text-sm text-white shadow-sm sm:flex-row sm:items-center sm:justify-between">
          <nav className="flex flex-wrap gap-3 text-slate-300">
            <Link className="underline-offset-4 hover:underline" href="/">
              トップ
            </Link>
            <Link className="underline-offset-4 hover:underline" href="/about">
              About
            </Link>
            <Link className="underline-offset-4 hover:underline" href="/faq">
              FAQ
            </Link>
          </nav>
          <a
            className="inline-flex items-center gap-2 font-semibold underline-offset-4 hover:underline"
            href={SOURCE_SITE_URL}
            rel="noreferrer"
            target="_blank"
          >
            参考: {SOURCE_SITE_LABEL}
            <ExternalLink className="h-4 w-4" />
          </a>
        </footer>
      </div>
    </main>
  );
}
