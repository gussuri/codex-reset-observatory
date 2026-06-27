import Link from "next/link";
import type { Locale } from "@/lib/radar/types";

type FaqViewProps = {
  locale: Locale;
};

type FaqItem = {
  question: string;
  answer: string;
};

export function FaqView({ locale }: FaqViewProps) {
  const translations = {
    ja: {
      category: "CodexリセットFAQ",
      title: "よくある質問",
      subTitle: "リセットの見方を整理しています。",
      backTop: "トップへ戻る",
      about: "Aboutを見る",
      history: "履歴を見る",
      otherLang: "English FAQ",
      faqs: [
        {
          question: "このサイトでは何を表示していますか？",
          answer: "Codexのリセット履歴、公式予告、コミュニティ上の動きなどをもとに、現在の状況を分かりやすく整理しています。",
        },
        {
          question: "リセット期待度とは何ですか？",
          answer: "今後リセットが行われる可能性の目安です。公式予告、Statusの障害情報、コミュニティの動き、過去の履歴などを参考にしています。公式な確率ではありません。",
        },
        {
          question: "Codexのリセットタイミングはいつ分かりますか？",
          answer: "公式予告がある場合は、その内容を優先して確認します。予告がない場合は、直近の履歴やStatusの動きから現在の見立てを表示しています。",
        },
        {
          question: "トークン・使用量・制限・レートのリセットは同じ意味ですか？",
          answer: "検索では似た意味で使われることがあります。このサイトでは、Codexの利用上限や使用量の回復につながるリセットを中心に扱っています。",
        },
        {
          question: "詫びリセットとは何ですか？",
          answer: "障害や不具合への補償として行われるリセットです。利用上限の回復や追加付与が行われる場合があります。",
        },
        {
          question: "ご祝儀リセットとは何ですか？",
          answer: "ユーザー数到達や記念イベントなどを理由として行われる特別なリセットです。",
        },
        {
          question: "臨時リセットと定期リセットの違いは？",
          answer: "定期リセットは通常の利用枠更新です。臨時リセットは障害対応や記念イベントなどをきっかけに発生する特別なリセットです。",
        },
        {
          question: "公式予告とコミュニティ予測の違いは？",
          answer: "公式予告はOpenAIや関係者による発表です。コミュニティ予測は利用者の報告や状況証拠から期待度として整理したものです。",
        },
        {
          question: "コンテキストリセットとは関係ありますか？",
          answer: "コンテキスト圧縮や長いセッションの不具合が、利用上限の補償リセットにつながる場合があります。単なる会話や作業状態のリセットとは分けて見ています。",
        },
        {
          question: "Codex CLIのリセットも確認できますか？",
          answer: "Codex全体の利用上限やStatusに関係する動きは参考になります。一方で、CLIの設定初期化やローカル環境のリセットはこのサイトの対象外です。",
        },
        {
          question: "このサイトの情報はどこから取得していますか？",
          answer: "過去のリセット履歴、公式発表、OpenAI Status、コミュニティ上の公開情報などを参考にしています。",
        },
        {
          question: "任意リセット（マニュアルリセット）や紹介特典は影響しますか？",
          answer: "任意リセット等を使用した場合、次回定期リセット日がこちらに表示している日付とずれます。配布された任意リセット枠には1か月以内の期限があります。",
        },
      ] as Array<FaqItem>,
    },
    en: {
      category: "Codex Reset FAQ",
      title: "Frequently Asked Questions",
      subTitle: "A short guide to Codex reset timing, usage limits, and manual reset credits.",
      backTop: "Back to English top",
      about: "About",
      history: "History",
      otherLang: "Japanese FAQ",
      faqs: [
        {
          question: "What does this site track?",
          answer: "It tracks Codex reset notices, reset history, weekly-cycle reference dates, and random reset probability based on community activity and OpenAI status updates.",
        },
        {
          question: "What is the random reset probability?",
          answer: "It is a reference estimate of how likely a reset will happen soon, based on official notices, Status incident logs, community reports, and history patterns. It is not an official probability.",
        },
        {
          question: "When can I know the Codex reset timing?",
          answer: "If there is an official notice, that takes priority. If there is no notice, this site shows the current estimate based on recent history and OpenAI Status activity.",
        },
        {
          question: "Are token, usage, limit, and rate resets the same thing?",
          answer: "People often use those terms loosely when searching. This site focuses on resets that restore or affect Codex usage limits.",
        },
        {
          question: "What is a compensation reset (Wabi-reset)?",
          answer: "A reset executed as compensation for incidents or issues. It may restore usage limits or grant extra credits to affected plans.",
        },
        {
          question: "What is a celebration reset?",
          answer: "A special reset executed to celebrate milestones like user count achievements or product anniversaries.",
        },
        {
          question: "What is the difference between a temporary (random) reset and a weekly reset?",
          answer: "A weekly reset is the regular usage-cycle refresh. A temporary reset is an extra refresh triggered by incidents or celebration events.",
        },
        {
          question: "What is the difference between official notices and community signals?",
          answer: "Official notices are announcements by Anysphere/OpenAI or their team members. Community signals are gathered from user reports and circumstantial evidence.",
        },
        {
          question: "Is a context reset related to Codex usage resets?",
          answer: "Sometimes. Issues with context compaction or long sessions can lead to compensation resets, but a local context reset is different from a global usage-limit reset.",
        },
        {
          question: "Does this site track Codex CLI resets?",
          answer: "While CLI issues affecting Codex usage limits or Status are relevant, local CLI settings initialization or local environment resets are outside the scope of this site.",
        },
        {
          question: "Where does this site get its information?",
          answer: "It refers to confirmed past reset history, official developer notices, OpenAI Status API, and public community reports.",
        },
        {
          question: "What happens if I use a manual reset or get referral credits?",
          answer: "If you use a manual reset, your account's next weekly reset date will differ from the reference date shown here. Manual reset credits expire within one month.",
        },
      ] as Array<FaqItem>,
    },
    zh: {
      category: "Codex 重置 FAQ",
      title: "常见问题解答",
      subTitle: "为您解答重置的具体看点、时机和手动重置额度问题。",
      backTop: "返回中文首页",
      about: "关于我们",
      history: "历史记录",
      otherLang: "日本語 FAQ",
      faqs: [
        {
          question: "这个网站显示什么内容？",
          answer: "它基于 Codex 重置历史、官方预告、社区动态以及 OpenAI 服务状态，为您清晰地整理当前重置的最新状况。",
        },
        {
          question: "重置期望度是指什么？",
          answer: "它是指今后可能执行重置的参考概率。我们参考了官方预告、服务状态故障信息、社区讨论以及历史规律等。这并非官方概率。",
        },
        {
          question: "我什么时候可以知道 Codex 重置的具体时间？",
          answer: "如果官方发布了预告，请优先确认该预告的内容。在没有预告的情况下，我们会根据最近的重置历史和 Status 故障动态来显示当前的预测。",
        },
        {
          question: "Token、使用额度、使用限制、速率限制的重置是同一个意思吗？",
          answer: "在搜索中，人们经常混用这些词语。本网站主要关注可以恢复或影响 Codex 使用上限的重置。",
        },
        {
          question: "什么是补偿重置（Apology reset）？",
          answer: "指为了补偿服务故障或异常问题而执行的重置。通常会恢复使用限额或为受影响的计划追加额度。",
        },
        {
          question: "什么是庆祝重置（Celebration reset）？",
          answer: "指为庆祝达到特定用户数或周年纪念等事件而执行的特殊重置。",
        },
        {
          question: "临时重置和定期重置有什么区别？",
          answer: "定期重置是常规的使用限额周期性更新。临时重置是因为故障处理或庆祝活动等触发的额外重置。",
        },
        {
          question: "官方预告与社区预测有什么区别？",
          answer: "官方预告是指 OpenAI 或开发团队成员发布的公告。社区预测是根据用户的反馈以及状况证据整理出的重置期望度。",
        },
        {
          question: "这与上下文重置（Context Reset）有关吗？",
          answer: "有时存在关联。长会话的上下文压缩缓存或处理异常可能会导致官方提供使用限制的补偿重置。但这与单纯重置聊天上下文或工作状态是不同的概念。",
        },
        {
          question: "在这里可以确认 Codex CLI 的重置吗？",
          answer: "涉及 Codex 整体使用限额或服务状态的故障动态会有所参考。但对于本地 CLI 的设置初始化或本地环境重置，并不属于本站的观测范围。",
        },
        {
          question: "这个网站的信息是从哪里获取的？",
          answer: "我们参考了历史确立的重置记录、官方公告、OpenAI Status 以及社区内的公开反馈等信息。",
        },
        {
          question: "手动重置（任意重置）或推荐奖励会产生影响吗？",
          answer: "如果您使用了手动重置，您账号的下一次定期重置日期将与此处显示的共享参考日期有所不同。发放的手动重置限额在一个月内有效。",
        },
      ] as Array<FaqItem>,
    },
  }[locale];

  const faqJsonLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: translations.faqs.map((faq) => ({
      "@type": "Question",
      name: faq.question,
      acceptedAnswer: {
        "@type": "Answer",
        text: faq.answer,
      },
    })),
  };

  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8" lang={locale}>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            {translations.category}
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            {translations.title}
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            {translations.subTitle}
          </p>
        </header>

        <section className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          {translations.faqs.map((faq) => (
            <article className="py-5 first:pt-0 last:pb-0" key={faq.question}>
              <h2 className="text-lg font-semibold leading-7 text-slate-950">
                {faq.question}
              </h2>
              <p className="mt-2 text-sm leading-7 text-slate-700">
                {faq.answer}
              </p>
            </article>
          ))}
        </section>

        <nav className="flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href={locale === "ja" ? "/" : locale === "en" ? "/en" : "/zh"}>
            {translations.backTop}
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href={locale === "ja" ? "/about" : locale === "en" ? "/en/about" : "/zh/about"}>
            {translations.about}
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href={locale === "ja" ? "/history" : locale === "en" ? "/en/history" : "/zh/history"}>
            {translations.history}
          </Link>
          {locale === "ja" ? (
            <>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/faq">
                English FAQ
              </Link>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/zh/faq">
                简体中文 FAQ
              </Link>
            </>
          ) : locale === "en" ? (
            <>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/faq">
                日本語 FAQ
              </Link>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/zh/faq">
                简体中文 FAQ
              </Link>
            </>
          ) : (
            <>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/faq">
                日本語 FAQ
              </Link>
              <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/faq">
                English FAQ
              </Link>
            </>
          )}
        </nav>
      </div>
    </main>
  );
}
