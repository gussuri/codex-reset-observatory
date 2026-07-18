# Mobile Dashboard Readability Design

## Goal

Improve the Japanese mobile dashboard header and top reset-history cards without changing the desktop presentation or forecast behavior.

## Scope

- Apply visual changes below the existing `sm` breakpoint only.
- Keep the current routes, data model, forecast values, and history page unchanged.
- Keep the top dashboard history at seven entries on mobile.

## Header

- Preserve the radar mark, site title, language links, and introductory meaning.
- Reduce mobile-only logo, title, spacing, and description dimensions so the first screen is shorter.
- Keep the description to a compact two-line maximum where practical.
- Keep language links usable and wrapped below the identity area when needed.

## History cards

- Preserve the existing title, reset details, timestamps, and source links.
- On mobile, separate each item with a subtle surface, border, and left accent so adjacent resets are easy to distinguish.
- Keep the timestamp/source block visually secondary but clearly separated from the descriptive details.
- Hide only low-priority scope metadata on the dashboard mobile view; the full History page remains unchanged.

## Responsive boundary

Desktop styles at `sm` and above remain the current layout. Any mobile-specific class has an explicit desktop reset where necessary, so the change cannot alter the PC view.

## Verification

- Run lint, tests, and build.
- Check the dashboard at 320px, 360px, and 390px widths for wrapping, clipping, and horizontal overflow.
- Check a desktop viewport to confirm the original header and three-item history presentation remain unchanged.
- Confirm the full History page still exposes all detail fields.
