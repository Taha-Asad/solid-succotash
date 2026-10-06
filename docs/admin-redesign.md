# Admin frontend redesign

## Scope and findings

The active admin frontend is `src/features/super-admin`, rendered by `src/App.tsx` for a super administrator. The application uses React, Mantine and a Tauri command API; `cloud-saas-core/frontend` is a separate scaffold.

The previous console duplicated navigation between an icon rail and a directory sidebar. Several directory entries routed to the same unfiltered tenant view. The overview gave an arbitrary row a selected appearance and displayed a hardcoded capacity of 50. Failed requests looked like empty data. A theme migration overwrote existing choices. The overview drawer's edit handler did nothing, and registration did not refresh the overview.

## Implemented direction

Corbel remains the product identity, with its existing mark and a restrained “by The Foolish Crow” endorsement. Charcoal and warm ivory surfaces share muted gold accents. Shared colors live in `saTheme.tsx`; shell and overview layout rules live in `admin.css`.

One labeled navigation area replaces the rail and directory. The overview prioritizes real tenant counts, active access, platform users and plans currently in use. A searchable semantic table opens tenant details. Subscription status is explicitly separate from tenant access. The arbitrary quota gauge and decorative quick-access modules are no longer mounted in the overview.

Tenant and package cards, analytics, settings and primary modal controls use coordinated colors. Theme selection persists. Registration and edit callbacks refresh data. Tenant cards support Enter/Space activation; the shell includes a skip link and adapts to narrow viewports.

## Verification

- `npm run build`: passed (TypeScript and Vite production build).
- `git diff --check`: passed.
- Browser fixture checks: all five navigation views, overview search, both themes, theme persistence, 390px overview document width, partial API failure, and empty tenant state passed.
- Light/dark desktop and mobile screenshots inspected.
- Main foreground/background, muted text, selected navigation and primary button color pairs exceed 4.5:1 in both themes. This is a targeted token check, not a full accessibility audit.

A repeatable browser smoke script is available at `scripts/admin-ui-smoke.mjs`. Start Vite, then run `node scripts/admin-ui-smoke.mjs` with an installed Playwright Chromium browser. Optional `ADMIN_REVIEW_URL` and `CHROMIUM_PATH` override the server and browser. The script mocks Tauri commands inside an isolated browser context; it does not change production authentication or real tenant records. Screenshots are written to `/tmp/corbel-admin-*.png`.

Live Tauri mutations and native WebView rendering were not exercised. Existing build warnings about Lottie eval and large chunks remain. Newly written overview copy is English, consistent with the previous overview; the existing navigation translations and language control remain available.
