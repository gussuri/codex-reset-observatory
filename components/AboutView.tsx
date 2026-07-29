import Link from "next/link";
import type { Locale } from "@/lib/radar/types";
import { translateUI } from "@/lib/radar/i18n";

type AboutViewProps = {
  locale: Locale;
};

export function AboutView({ locale }: AboutViewProps) {
  const content = {
    ja: {
      category: "Codexリセット観測",
      title: "Codexリセット観測所について",
      subTitle: "Codexのリセット情報を観測・整理する非公式サイトです。",
      paragraphs: [
        "Codexリセット観測所は、Codexのリセット情報を観測・整理する非公式サイトです。",
        "リセット履歴、公式予告、コミュニティ上の動きなどをもとに、現在の状況を分かりやすく確認できるようまとめています。",
        "ランダムリセット期待度は公式情報ではなく、公開情報や過去の履歴を参考にした観測上の目安です。",
        "実際のリセット実施有無や時期については、必ず公式情報をご確認ください。",
        "任意リセット（マニュアルリセット）や友達紹介リセットを使用した場合、次回定期リセット日がこちらに表示している日付とずれます。任意リセット（マニュアルリセット）枠には、付与から1ヶ月間の有効期限があります。",
      ],
      nav: {
        top: "トップへ戻る",
        faq: "FAQを見る",
        history: "履歴を見る",
      },
    },
    en: {
      category: "Codex reset reference",
      title: "About Codex Reset Observatory",
      subTitle: "An unofficial reference site for Codex reset history, weekly reset references, Banked Reset credits, and unscheduled reset signals.",
      paragraphs: [
        "Codex Reset Observatory collects reset-related information in one place so users can quickly check recent reset history and the current reset situation.",
        "It brings together official reset notices, past reset history, and a weekly-cycle reference date so you can compare what is happening now with earlier reset patterns.",
        "The weekly reset date is a shared reference, not a guarantee that every account will refresh on exactly the same date.",
        "The unscheduled reset probability is a reference estimate based on public signals, usage-limit anomalies, community activity, and official updates. It is not an official OpenAI notice.",
        "Banked Reset credits (manual resets) are account-specific. If you use one, your next weekly reset date will differ from the shared reference date shown here. The Banked Reset credit is a one-time credit and expires within one month.",
      ],
      nav: {
        top: "Back to English top",
        faq: "FAQ",
        history: "History",
      },
    },
    zh: {
      category: "Codex 重置观测",
      title: "关于 Codex 重置观测所",
      subTitle: "一个用于了解 Codex 重置历史、每周循环重置参考日、手动重置额度以及随机重置信号的非官方参考网站。",
      paragraphs: [
        "Codex 重置观测所旨在将重置相关的信息汇总在一处，以便用户快速查看最近的重置历史和当前的重置状况。",
        "它汇集了官方重置预告、历史重置记录以及每周循环参考日期，让您可以将当前状况与早期的重置模式进行对比。",
        "每周重置日期仅为共享的参考基准，并不能保证每个账号都会在完全相同的日期刷新。",
        "随机重置期望度是基于公开信号、使用限制异常、社区活跃度以及官方更新整理出的参考估算值，并非 OpenAI 官方通知。",
        "手动重置额度是针对特定账号的。如果您使用了手动重置，您账号的下一次每周重置日期将与此处显示的共享参考日期有所不同。手动重置额度为一次性额度，且在一个月内有效。",
      ],
      nav: {
        top: "返回中文首页",
        faq: "常见问题",
        history: "历史记录",
      },
    },
  }[locale];

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" lang={locale}>
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            {content.category}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            {content.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {content.subTitle}
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="space-y-4 text-sm leading-7 text-slate-700">
            {content.paragraphs.map((p, idx) => (
              <p key={idx}>{p}</p>
            ))}
          </div>
        </section>

        <nav className="flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href={locale === "ja" ? "/" : locale === "en" ? "/en" : "/zh"}>
            {content.nav.top}
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href={locale === "ja" ? "/faq" : locale === "en" ? "/en/faq" : "/zh/faq"}>
            {content.nav.faq}
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href={locale === "ja" ? "/history" : locale === "en" ? "/en/history" : "/zh/history"}>
            {content.nav.history}
          </Link>
          {locale === "ja" ? (
            <>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/about">
                English
              </Link>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/zh/about">
                简体中文
              </Link>
            </>
          ) : locale === "en" ? (
            <>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/about">
                日本語
              </Link>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/zh/about">
                简体中文
              </Link>
            </>
          ) : (
            <>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/about">
                日本語
              </Link>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/about">
                English
              </Link>
            </>
          )}
        </nav>
      </div>
    </main>
  );
}
