# Analytics configuration

Google Analytics is optional. To enable the site tag, set `NEXT_PUBLIC_GA_MEASUREMENT_ID` in the hosting environment to the GA4 web stream ID (`G-` followed by 10 letters or digits). Leave it unset to omit the Google tag. The site does not need a server key or API endpoint for measurement.

The tag disables Google Signals and advertising personalization. The site records the initial page view and emits one `sponsor_click` event when a GitHub Sponsors link is activated. That event contains only `placement` (`header`, `panel`, `footer`, or `about`), `locale` (`ja`, `en`, or `zh`), and `page_type` (`home`, `history`, `faq`, or `about`). The explicit page location contains the origin and pathname without query parameters or fragments.

The About page links to Google's Privacy Policy and its Google Analytics opt-out information. The site does not claim that analytics is disabled in every region or make a consent promise.
