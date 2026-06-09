import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "このサイトは何を観測していますか？",
    answer:
      "Codexの公式リセット予告、定期リセット、履歴、期待度を観測しています。",
  },
  {
    question: "リセットとは何ですか？",
    answer:
      "障害への補償、記念イベント、公式予告、臨時対応などをきっかけに発生するCodex利用枠のリセットです。このサイトでは、詫びリセット、ご祝儀リセット、予告付き臨時リセット、コミュニティ上で期待されているリセットをまとめて扱っています。",
  },
  {
    question: "臨時リセットと通常リセットの違いは？",
    answer:
      "通常リセットは決まったサイクルの利用枠更新です。臨時リセットは、障害対応・補償・記念などをきっかけに発生する一時的なリセットです。",
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
      "近いうちにリセットが発生する可能性の目安です。公式予告、Status上の問題、コミュニティの利用上限への不満やリセット要望などをもとにしています。",
  },
  {
    question: "公式予告と定期リセットの違いは？",
    answer:
      "公式予告は、OpenAIや関係者による発表など、リセット実施に近い明確なシグナルです。定期リセットは、Codexに書かれている情報やサイト側で把握した実績をもとに表示する予定情報で、予測ではなく実態に合わせて更新します。",
  },
];

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Codexのリセット、臨時リセット、補償リセット、公式予告、定期リセットの違いを説明します。",
};

export default function FaqPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
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
        </nav>
      </div>
    </main>
  );
}
