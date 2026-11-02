import { translateUI } from "@/lib/radar/i18n";
import type { Locale } from "@/lib/radar/types";
import { SponsorLink } from "./SponsorLink";

export function SponsorSupportPanel({ locale }: { locale: Locale }) {
  return (
    <section
      aria-labelledby="sponsor-support-title"
      className="rounded-lg border border-slate-200 bg-white/80 p-3 sm:p-4"
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <h2
            className="text-sm font-medium leading-5 text-slate-800"
            id="sponsor-support-title"
          >
            {translateUI("sponsorPanelTitle", locale)}
          </h2>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-600">
            {translateUI("sponsorPanelBody", locale)}
          </p>
        </div>
        <div className="shrink-0">
          <SponsorLink
            className="inline-flex min-h-11 items-center text-sm text-slate-700 underline underline-offset-4 transition-colors hover:text-teal-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-700 focus-visible:ring-offset-2"
            locale={locale}
            pageType="home"
            placement="panel"
          >
            {translateUI("sponsorLink", locale)}
          </SponsorLink>
        </div>
      </div>
    </section>
  );
}
