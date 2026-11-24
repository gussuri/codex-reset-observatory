import { translateUI } from "@/lib/radar/i18n";
import type { Locale } from "@/lib/radar/types";
import { SponsorLink } from "./SponsorLink";

export function SponsorSupportPanel({ locale }: { locale: Locale }) {
  return (
    <section
      aria-labelledby="sponsor-support-title"
      className="rounded-lg border border-fuchsia-200 bg-rose-50/75 px-4 py-3 shadow-sm sm:px-5 sm:py-3"
    >
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-center sm:gap-6">
        <div className="min-w-0">
          <h2
            className="text-base font-semibold leading-snug text-fuchsia-950 sm:text-lg"
            id="sponsor-support-title"
          >
            {translateUI("sponsorPanelTitle", locale)}
          </h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-600 sm:text-sm">
            {translateUI("sponsorPanelBody", locale)}
          </p>
        </div>
        <SponsorLink
          className="inline-flex min-h-10 w-full shrink-0 items-center justify-center rounded-md bg-fuchsia-700 px-4 py-2 text-center text-sm font-semibold leading-5 text-white shadow-sm transition-colors hover:bg-fuchsia-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-fuchsia-700 focus-visible:ring-offset-2 sm:w-auto"
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
