import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "このサイトについて",
  description:
    "Codexリセット観測所は、Codexのリセット履歴、定期リセット、任意リセット、期待度をまとめる非公式サイトです。",
  alternates: {
    canonical: "/about",
    languages: {
      ja: "/about",
      en: "/en/about",
    },
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen px-4 py-6 sm:px-6 lg:px-8">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5">
        <header className="rounded-lg border border-slate-200/80 bg-white/88 p-5 shadow-sm backdrop-blur">
          <p className="text-sm font-medium text-teal-700">
            Codexリセット観測
          </p>
          <h1 className="mt-2 text-3xl font-semibold leading-tight text-slate-950">
            Codexリセット観測所について
          </h1>
          <p className="mt-3 text-sm leading-6 text-slate-600">
            Codexのリセット履歴、定期リセット、任意リセット、期待度をまとめる非公式サイトです。
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="space-y-4 text-sm leading-7 text-slate-700">
            <p>
              Codexリセット観測所は、Codexのリセット履歴や次回定期リセットの目安を日本語で確認できる非公式サイトです。
            </p>
            <p>
              確認済みの履歴や定期リセット情報は、このサイト側にも保存しています。外部サイトの情報は、判断材料のひとつとして参照します。
            </p>
            <p>
              ランダムリセット期待度は公式情報ではなく、公開情報やコミュニティの動きをもとにした参考用の見立てです。
            </p>
            <p>
              実際のリセット実施有無や時期は、必ず公式情報もあわせてご確認ください。
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
