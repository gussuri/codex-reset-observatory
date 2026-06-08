import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "このサイトについて",
  description:
    "Codexリセット観測所は、Codexのランダムリセット、臨時リセット、補償リセット、記念リセットの予告・履歴・期待度を整理する非公式サイトです。",
};

export default function AboutPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            Codexランダムリセット観測
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            Codexリセット観測所について
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            詫び・ご祝儀・予告付き臨時対応などによるCodexのランダムリセット情報を、日本語で整理する非公式サイトです。
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="space-y-4 text-sm leading-7 text-slate-700">
            <p>
              Codexリセット観測所は、Codexのランダムリセット情報を観測・整理する非公式サイトです。
            </p>
            <p>
              主に扱うのは、週次の定期リセットではなく、障害や不具合への補償、到達記念、臨時対応などによって行われるリセットです。
            </p>
            <p>
              リセット期待度は公式情報ではありません。Codex Reset Radarの公開JSONをもとに、公式予告の有無やコミュニティ上の動きを日本語で見やすく整理した目安です。
            </p>
            <p>
              実際にリセットが行われるか、いつ行われるかの最終判断は、必ずOpenAIや関係者による公式情報を確認してください。
            </p>
          </div>
        </section>

        <nav className="flex flex-wrap gap-3 text-sm">
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/">
            トップへ戻る
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/faq">
            FAQを見る
          </Link>
          <Link className="font-semibold text-teal-700 underline-offset-4 hover:underline" href="/history">
            履歴を見る
          </Link>
        </nav>
      </div>
    </main>
  );
}
