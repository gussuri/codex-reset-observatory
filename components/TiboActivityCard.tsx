import { ExternalLink, MessageCircle } from "lucide-react";
import { LocalizedDateTime } from "@/components/LocalizedDateTime";
import { translateUI } from "@/lib/radar/i18n";
import type { Locale, PublicTiboActivity } from "@/lib/radar/types";

function getClassificationKey(
  classification: PublicTiboActivity["classification"],
) {
  switch (classification) {
    case "official_notice":
      return "tiboClassificationOfficialNotice";
    case "reset_executed":
      return "tiboClassificationResetExecuted";
    case "teaser":
      return "tiboClassificationTeaser";
    case "irrelevant":
      return "tiboClassificationIrrelevant";
  }
}

export function TiboActivityCard({
  activity,
  locale,
}: {
  activity: PublicTiboActivity;
  locale: Locale;
}) {
  return (
    <section
      aria-labelledby="tibo-activity-heading"
      className="rounded-lg border border-slate-200 bg-white/80 p-4 text-slate-700 shadow-sm sm:p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-medium text-slate-500">
            {translateUI("tiboLatestActivity", locale)}
          </p>
          <h2
            id="tibo-activity-heading"
            className="mt-1 text-lg font-semibold leading-tight text-slate-950 sm:text-xl"
          >
            {translateUI("tiboLatestPost", locale)}
          </h2>
        </div>
        <MessageCircle className="h-6 w-6 shrink-0 text-teal-700" aria-hidden="true" />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <p className="min-w-0 break-words text-sm leading-6 text-slate-700">
          {activity.text ?? translateUI("tiboNoPostText", locale)}
        </p>

        <dl className="grid gap-3 text-sm sm:min-w-52 sm:text-right">
          <div>
            <dt className="text-xs font-semibold text-slate-500">
              {translateUI("tiboAutoClassification", locale)}
            </dt>
            <dd className="mt-1 font-semibold text-slate-950">
              {translateUI(getClassificationKey(activity.classification), locale)}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-semibold text-slate-500">
              {translateUI("tiboPostDate", locale)}
            </dt>
            <dd className="mt-1 font-medium text-slate-700">
              <LocalizedDateTime value={activity.createdAt} locale={locale} />
            </dd>
          </div>
          {activity.sourceUrl ? (
            <div>
              <dt className="sr-only">{translateUI("source", locale)}</dt>
              <dd>
                <a
                  className="inline-flex items-center gap-1 font-semibold text-teal-700 underline-offset-4 hover:underline"
                  href={activity.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  {translateUI("tiboViewPost", locale)}
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </a>
              </dd>
            </div>
          ) : null}
        </dl>
      </div>
    </section>
  );
}
