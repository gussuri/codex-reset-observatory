import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "このサイトは何を観測していますか？",
    answer:
      "Codexの臨時・補償・記念などのリセット情報について、予告、履歴、期待度を日本語で整理しています。",
  },
  {
    question: "このサイトで扱うリセットは？",
    answer:
      "障害対応、補償、記念イベント、公式予告など、通常とは異なるリセット情報を中心に掲載しています。",
  },
  {
    question: "定期リセットとランダムリセットの違いは？",
    answer:
      "定期リセットは通常の利用枠更新、ランダムリセットは障害対応・補償・記念などをきっかけに発生する臨時のリセットを指します。",
  },
  {
    question: "ランダムリセットとは何ですか？",
    answer:
      "このサイトでは、補償、記念イベント、公式予告、臨時対応などをきっかけに発生するCodex利用枠のリセットをランダムリセットと呼んでいます。",
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
      "近いうちにランダムリセットが発生する可能性の目安です。公式予告、Status上の問題、コミュニティの利用上限への不満やリセット要望などをもとにしています。",
  },
  {
    question: "公式予告とコミュニティ予測の違いは？",
    answer:
      "公式予告は、OpenAIや関係者による発表など、リセット実施に近い明確なシグナルです。コミュニティ予測は、利用者の投稿や状況証拠から期待度として読むものです。",
  },
];

export const metadata: Metadata = {
  title: "FAQ",
  description:
    "Codexのランダムリセット、臨時リセット、補償リセット、公式予告、コミュニティ予測の違いを説明します。",
};

export default function FaqPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            CodexランダムリセットFAQ
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            よくある質問
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            臨時・補償・記念などのリセット情報を、どう見るかを整理しています。
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
