import { translateUI } from "@/lib/radar/i18n";
import type { Locale } from "@/lib/radar/types";
import { SponsorLink } from "./SponsorLink";

export function SponsorSupportPanel({ locale }: { locale: Locale }) {
  return (
    <section
      aria-labelledby="sponsor-support-title"
      className="rounded-lg border border-fuchsia-200 bg-rose-50/75 p-4 shadow-sm sm:p-5"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2
            className="text-lg font-semibold leading-snug text-fuchsia-950 sm:text-xl"
            id="sponsor-support-title"
          >
            {translateUI("sponsorPanelTitle", locale)}
          </h2>
          <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-700">
            {translateUI("sponsorPanelBody", locale)}
          </p>
        </div>
        <SponsorLink
          className="inline-flex min-h-11 w-full shrink-0 items-center justify-center rounded-md bg-fuchsia-700 px-4 py-2 text-center text-sm font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-fuchsia-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-700 focus-visible:ring-offset-2 sm:w-auto"
          locale={locale}
          pageType="home"
          placement="panel"
        >
          {translateUI("sponsorLink", locale)}
        </SponsorLink>
      </div>
    </section>
  );
}
