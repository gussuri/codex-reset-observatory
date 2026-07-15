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
          question: "任意リセットを使うとどうなりますか？",
          answer: "任意リセットを使用すると、5時間制限と1週間制限がリセットされ100％になります。さらに次回の定期リセットが1週間後に変更されます。任意リセットを使用すると、こちらのサイトに表示される定期リセットのタイミングとずれるので注意してください。",
        },
      ] as Array<FaqItem>,
    },
    en: {
      category: "Codex Reset FAQ",
      title: "Frequently Asked Questions",
      subTitle: "A short guide to Codex usage limits resets, reset timing, manual reset credits, and forecast changes.",
      backTop: "Back to English top",
      about: "About",
      history: "History",
      otherLang: "Japanese FAQ",
      faqs: [
        {
          question: "Did Codex reset today?",
          answer: "Check the latest reset card and recent reset history on the top page. If a reset was confirmed today, it should appear as a recent reset event. If there is only a forecast, treat it as an estimate rather than a confirmed reset.",
        },
        {
          question: "When is the next Codex usage limits reset?",
          answer: "OpenAI does not always publish an exact reset time. This site shows a weekly-cycle reference date when available and estimates whether an extra usage-limits reset looks likely within the next 24 or 48 hours.",
        },
        {
          question: "How does Codex reset work?",
          answer: "A Codex reset usually restores or refreshes usage limits such as weekly limits or shorter usage windows. Some resets follow a regular cycle, while others may happen after incidents, capacity issues, or special events.",
        },
        {
          question: "What is Codex manual reset?",
          answer: "A manual reset is an account-specific reset credit. Using it can restore your 5-hour and 1-week limits to 100%, and your next weekly reset date may move to one week after the moment you use it.",
        },
        {
          question: "What is Codex usage limits reset?",
          answer: "It means the Codex usage allowance or rate-limit window is refreshed. People may search for it as a token reset, limit reset, usage reset, or rate reset; this site groups those searches around Codex usage-limit recovery.",
        },
        {
          question: "Why does the reset forecast change?",
          answer: "The forecast changes as official notices, OpenAI Status incidents, capacity or rate-limit signals, community reports, and elapsed time since the last reset change. The percentage is not guaranteed and may move up or down.",
        },
        {
          question: "What does this site track?",
          answer: "It tracks Codex usage-limits reset notices, reset history, weekly-cycle reference dates, and random reset probability based on public information, community activity, and OpenAI Status updates.",
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
          question: "What happens if I use a manual reset?",
          answer: "Using a manual reset restores both your 5-hour and 1-week limits to 100%. Additionally, your next weekly reset date will be rescheduled to exactly one week from the moment of use. Please note that this will cause your reset timing to differ from the reference weekly reset date shown on this site.",
        },
      ] as Array<FaqItem>,
    },
    zh: {
      category: "Codex 重置常见问题",
      title: "常见问题解答",
      subTitle: "这里汇总了有关 Codex 重置状态、重置时机以及手动重置次数的常见问题。",
      backTop: "返回中文首页",
      about: "关于我们",
      history: "历史记录",
      otherLang: "日本語 FAQ",
      faqs: [
        {
          question: "本网站提供哪些信息？",
          answer: "本站根据 Codex 重置历史、官方预告、社区动态以及 OpenAI 服务状态，整理当前的重置情况和最新进展。",
        },
        {
          question: "重置可能性是什么意思？",
          answer: "重置可能性表示未来发生重置的参考概率。计算时会参考官方预告、OpenAI Status 上的故障信息、社区讨论以及历史规律等。这并不是 OpenAI 官方公布的概率。",
        },
        {
          question: "什么时候可以知道 Codex 重置的具体时间？",
          answer: "如果官方发布了预告，请优先查看预告中的详细信息。在没有预告的情况下，本站会根据最近的重置历史、OpenAI Status 上的故障信息和社区动态显示当前预测。",
        },
        {
          question: "Token、额度、使用限制和速率限制的重置是同一回事吗？",
          answer: "用户在搜索时经常混用这些说法。本站主要关注能够恢复或影响 Codex 使用额度上限的重置事件。",
        },
        {
          question: "什么是补偿重置（Apology reset）？",
          answer: "补偿重置是指 OpenAI 为补偿服务故障或异常问题而进行的重置。具体形式可能包括恢复使用额度，或向受影响用户发放额外的手动重置机会。",
        },
        {
          question: "什么是庆祝重置（Celebration reset）？",
          answer: "庆祝重置是指为了庆祝活跃用户数达到特定里程碑、产品发布或纪念活动等事件而进行的特殊重置。",
        },
        {
          question: "不定期重置和定期重置有什么区别？",
          answer: "定期重置会按照正常的使用周期恢复额度。不定期重置则是由故障补偿、庆祝活动或其他特殊事件额外触发的重置。",
        },
        {
          question: "官方预告与社区预测有什么区别？",
          answer: "官方预告是指 OpenAI 或 Codex 开发团队成员公开发布的信息。社区预测则根据用户反馈、公开线索和历史记录估算重置可能性，并不代表官方安排。",
        },
        {
          question: "这与上下文重置（Context Reset）有关吗？",
          answer: "两者通常不是同一个概念。上下文重置涉及聊天会话的上下文、压缩处理或工作状态，而本站关注的是 Codex 使用额度和使用限制的重置。如果上下文相关故障导致官方提供额度补偿，本站可能会记录该补偿事件。",
        },
        {
          question: "本站可以查询 Codex CLI 的重置吗？",
          answer: "如果某次事件影响 Codex 整体的使用额度或服务状态，本站会将其纳入参考。但 Codex CLI 的本地设置初始化、配置重置或本地环境问题不属于本站的观测范围。",
        },
        {
          question: "本网站的信息来自哪里？",
          answer: "本站参考已经确认的历史重置记录、OpenAI 或开发团队成员发布的公告、OpenAI Status 以及社区中的公开反馈。",
        },
        {
          question: "使用手动重置后会发生什么？",
          answer: "使用手动重置后，5 小时和 1 周的使用限制会恢复至 100%。下一次定期重置时间也会调整为从使用手动重置起的一周后。因此，你的实际重置时间可能会与本站显示的公共定期重置参考日期不同。",
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
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm font-medium text-teal-700">
                {translations.category}
              </p>
              <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
                {translations.title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-600">
                {translations.subTitle}
              </p>
            </div>
            <nav
              aria-label="FAQ navigation"
              className="flex shrink-0 flex-wrap gap-2 text-sm"
            >
              <Link
                className="rounded-md border border-teal-200 bg-teal-50 px-3 py-1.5 font-semibold text-teal-700 underline-offset-4 hover:underline"
                href={locale === "ja" ? "/" : locale === "en" ? "/en" : "/zh"}
              >
                {translations.backTop}
              </Link>
              <Link
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 underline-offset-4 hover:underline"
                href={locale === "ja" ? "/about" : locale === "en" ? "/en/about" : "/zh/about"}
              >
                {translations.about}
              </Link>
              <Link
                className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-semibold text-slate-700 underline-offset-4 hover:underline"
                href={locale === "ja" ? "/history" : locale === "en" ? "/en/history" : "/zh/history"}
              >
                {translations.history}
              </Link>
            </nav>
          </div>
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
