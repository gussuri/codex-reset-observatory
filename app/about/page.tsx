import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "このサイトについて",
  description:
    "Codexリセット観測所は、Codexのリセット情報を観測・整理する非公式サイトです。",
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
            Codexのリセット情報を観測・整理する非公式サイトです。
          </p>
        </header>

        <section className="rounded-lg border border-slate-200 bg-white/90 p-5 shadow-sm">
          <div className="space-y-4 text-sm leading-7 text-slate-700">
            <p>
              Codexリセット観測所は、Codexのリセット情報を観測・整理する非公式サイトです。
            </p>
            <p>
              リセット履歴、公式予告、コミュニティ上の動きなどをもとに、現在の状況を分かりやすく確認できるようまとめています。
            </p>
            <p>
              ランダムリセット期待度は公式情報ではなく、公開情報や過去の履歴を参考にした観測上の目安です。
            </p>
            <p>
              実際のリセット実施有無や時期については、必ず公式情報をご確認ください。
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
