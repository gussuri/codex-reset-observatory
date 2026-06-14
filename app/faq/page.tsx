import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "このサイトでは何を表示していますか？",
    answer:
      "Codexのリセット履歴、公式予告、コミュニティ上の動きなどをもとに、現在の状況を分かりやすく整理しています。",
  },
  {
    question: "リセット期待度とは何ですか？",
    answer:
      "今後リセットが行われる可能性の目安です。公式予告、Statusの障害情報、コミュニティの動き、過去の履歴などを参考にしています。公式な確率ではありません。",
  },
  {
    question: "詫びリセットとは何ですか？",
    answer:
      "障害や不具合への補償として行われるリセットです。利用上限の回復や追加付与が行われる場合があります。",
  },
  {
    question: "ご祝儀リセットとは何ですか？",
    answer:
      "ユーザー数到達や記念イベントなどを理由として行われる特別なリセットです。",
  },
  {
    question: "臨時リセットと定期リセットの違いは？",
    answer:
      "定期リセットは通常の利用枠更新です。臨時リセットは障害対応や記念イベントなどをきっかけに発生する特別なリセットです。",
  },
  {
    question: "公式予告とコミュニティ予測の違いは？",
    answer:
      "公式予告はOpenAIや関係者による発表です。コミュニティ予測は利用者の報告や状況証拠から期待度として整理したものです。",
  },
  {
    question: "このサイトの情報はどこから取得していますか？",
    answer:
      "Codex Reset Radarの公開データ、公式発表、コミュニティ上の公開情報などを参考にしています。",
  },
  {
    question: "リセットは必ず発生しますか？",
    answer:
      "いいえ。期待度が高い場合でも実施されないことがあります。最終的には公式発表をご確認ください。",
  },
];

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Codexのリセット期待度、詫びリセット、ご祝儀リセット、公式予告とコミュニティ予測の違いを説明します。",
  alternates: {
    canonical: "/faq",
    languages: {
      ja: "/faq",
      en: "/en/faq",
    },
  },
};

const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: faqs.map((faq) => ({
    "@type": "Question",
    name: faq.question,
    acceptedAnswer: {
      "@type": "Answer",
      text: faq.answer,
    },
  })),
};

export default function FaqPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(faqJsonLd) }}
      />
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            CodexリセットFAQ
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            よくある質問
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            リセットの見方を整理しています。
          </p>
        </header>

        <section className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          {faqs.map((faq) => (
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
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/">
            トップへ戻る
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/about">
            Aboutを見る
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/history">
            履歴を見る
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/en/faq">
            English FAQ
          </Link>
        </nav>
      </div>
    </main>
  );
}
