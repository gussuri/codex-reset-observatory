import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "このサイトでは何を表示していますか？",
    answer:
      "Codexの公式リセット予告、リセット履歴、1週間サイクルの参考日、ランダムリセット期待度を表示しています。今の状況をざっくり確認し、過去の動きと見比べるための非公式サイトです。",
  },
  {
    question: "リセットとは何ですか？",
    answer:
      "障害への補償、記念イベント、公式予告、臨時対応などをきっかけに発生するCodex利用枠のリセットです。このサイトでは、詫びリセット、ご祝儀リセット、予告付き臨時リセット、コミュニティで話題になっているリセットをまとめて扱っています。",
  },
  {
    question: "臨時リセットと定期リセットの違いは？",
    answer:
      "定期リセットは決まったサイクルの利用枠更新です。臨時リセットは、障害対応・補償・記念などをきっかけに発生する一時的なリセットです。",
  },
  {
    question: "詫びリセットとは何ですか？",
    answer:
      "Codexや関連サービスの障害、利用枠の不具合、信頼性問題などへの補償として、利用上限が戻されるリセットです。",
  },
  {
    question: "ご祝儀リセットとは何ですか？",
    answer:
      "利用者数の到達記念など、イベント的な理由で行われるリセットです。障害補償とは別の臨時リセットとして扱います。",
  },
  {
    question: "リセット期待度は何を表していますか？",
    answer:
      "近いうちにランダムリセットが発生する可能性の目安です。公式予告、Status上の問題、利用上限まわりの異常、コミュニティの反応などをもとに、このサイト側で見立てています。",
  },
  {
    question: "公式予告と定期リセットの違いは？",
    answer:
      "公式予告は、OpenAIや関係者による発表など、リセット実施を示すかなり強い手がかりです。定期リセットは、1週間サイクルの利用枠更新を読むための参考日です。",
  },
  {
    question: "任意リセットを使うとどうなりますか？",
    answer:
      "任意リセットを使うと、そのアカウントの次回定期リセット日がこちらに表示している参考日とずれます。配布された任意リセットは1回分で、期限は1か月以内です。",
  },
  {
    question: "履歴を見るときの注意点は？",
    answer:
      "履歴は、過去に確認できたリセットや公式予告を後から見返しやすいように整理したものです。任意リセットや友達紹介リセットのように個人別のものは、全体向けの最新リセットやランダムリセット期待度とは分けて扱います。",
  },
  {
    question: "友達紹介リセットはどう扱いますか？",
    answer:
      "友達紹介リセットも、アカウントごとに付与・消費される個人別リセットとして扱います。配布記録は履歴に残しますが、全体向けの最新リセットやランダムリセット期待度には含めていません。",
  },
];

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Codexのリセット、臨時リセット、補償リセット、公式予告、定期リセット、任意リセット、友達紹介リセットの違いを説明します。",
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
            リセットの見方を簡単に整理しています。
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
