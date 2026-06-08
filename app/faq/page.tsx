import type { Metadata } from "next";
import Link from "next/link";

const faqs = [
  {
    question: "このサイトは何を観測していますか？",
    answer:
      "Codexの通常の週次リセットではなく、詫びリセット、ご祝儀リセット、予告付きの臨時リセットなど、ランダムリセットの予告・履歴・期待度を観測しています。",
  },
  {
    question: "定期リセットとランダムリセットの違いは？",
    answer:
      "定期リセットは通常の利用枠更新として予定どおり発生するものです。ランダムリセットは、障害への補償や記念イベントなどをきっかけに、通常スケジュールとは別に発生する臨時のリセットを指します。",
  },
  {
    question: "ランダムリセットとは何ですか？",
    answer:
      "このサイトでは、補償・記念・臨時対応・予告付き対応など、通常の週次更新とは別に発生するCodex利用枠のリセットをランダムリセットと呼んでいます。",
  },
  {
    question: "詫びリセットとは何ですか？",
    answer:
      "Codexや関連サービスの障害、利用枠の不具合、信頼性問題などへの補償として、利用上限が戻されるリセットです。公式の説明や関係者の投稿がある場合は重要な根拠として扱います。",
  },
  {
    question: "ご祝儀リセットとは何ですか？",
    answer:
      "利用者数の到達記念など、障害補償ではなくイベント的な理由で行われるリセットです。通常の定期リセットとは別枠の臨時リセットとして扱います。",
  },
  {
    question: "リセット期待度は何を表していますか？",
    answer:
      "近いうちにランダムリセットが発生する可能性の目安です。公式予告、Status上の問題、コミュニティの利用上限への不満やリセット要望などをもとにした観測情報であり、公式な確率ではありません。",
  },
  {
    question: "公式予告とコミュニティ予測の違いは？",
    answer:
      "公式予告は、OpenAIや関係者による発表など、リセット実施に近い明確なシグナルです。コミュニティ予測は、公式発表がない状態で、利用者の投稿や状況証拠から期待度として読むものです。",
  },
  {
    question: "このサイトはCodexの通常の週次リセットも扱いますか？",
    answer:
      "通常の週次・定期リセットは主な観測対象ではありません。このサイトは、臨時・補償・記念・予告付きのランダムリセットを中心に扱います。",
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
            通常の週次リセットではなく、臨時・補償・記念などのランダムリセットをどう見るかを整理しています。
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
