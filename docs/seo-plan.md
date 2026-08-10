# Project Carlo — Search Engine & Sharing Plan

A phased plan to improve organic search (SEO), structured data, browser-tab
presentation, and link-share previews (Open Graph / Twitter cards) for
[projectcarlo.com](https://projectcarlo.com).

Project Carlo is a directory of ~508 Catholic parishes that surfaces Mass,
Confession, and Adoration times parsed from weekly bulletins
(React 19 + Vite + Tailwind on Cloudflare Workers static assets).

## Current state

**Already in place (keep):**

- Church pages are **prerendered to static HTML** at `/churches/{slug}/index.html`
  (`apps/web/scripts/prerender.ts` + `src/prerender/StaticChurchPage.tsx`) — real
  content for crawlers, not a blank SPA shell.
- Per-church `<title>`, `<meta name="description">`, and `<link rel="canonical">`.
- `sitemap.xml` (with `<lastmod>`) + `robots.txt` generated at build.
- Trailing-slash canonicalization via `public/_redirects`.
- Clean SVG favicon.
- **Closed churches are removed from the dataset and their URLs 404** (owner decision,
  2026-08-06): no redirect to a sibling church, no tombstone page. A church that closes
  drops out of `churches.csv`, the prerender and the sitemap together. First case:
  `/churches/st-mary-batavia/` (Batavia, last Mass 14 Aug 2024). If closures ever become
  frequent enough to matter for organic traffic, revisit — the alternative on the table was
  a 301 to another church of the same parish.

**Gaps this plan addresses:**

| Gap | Impact |
| --- | --- |
| No Open Graph / Twitter Card tags anywhere | Shared links render bare in iMessage/WhatsApp/Slack/Facebook/X |
| No social share image asset | Empty previews even once OG tags exist |
| No JSON-LD structured data | Missing rich results — biggest organic lever for a local-listings site |
| SPA routes (`/`, `/landing`, client-navigated church page) keep the generic `index.html` title | Stale tabs/bookmarks; wrong canonical on `/landing` |
| Titles lack location + intent keywords | Misses "mass times", city, state that people search |
| No city/region pages | No capture of "mass times in {city}" long-tail across 508 parishes |
| No apple-touch-icon / web manifest | Weak iOS home-screen + tab presence |
| Church name is `<h2>`, no `<h1>` | Weakens the page's primary keyword signal |

## Search intent → page mapping

| Query | Target page | Needs |
| --- | --- | --- |
| "{parish} mass times / confession" | church page | name + service in title/h1 (mostly there) |
| "mass times near me" | homepage | keyworded home title + WebSite schema |
| "confession times in {city}" / "adoration {city}" | **city page (missing)** | new templated city pages |
| "catholic church {city} mass schedule" | city or church page | Church + Event schema |
| Shared link (text/Slack) | any page | OG + Twitter tags + image |
| "Project Carlo" | homepage | branded (fine) |

## Plan (phased by ROI)

### Phase 1 — Social previews & metadata foundation

1. Add Open Graph + Twitter tags to `index.html` (site defaults) and
   `StaticChurchPage.tsx` (per-church): `og:title`, `og:description`, `og:url`,
   `og:type`, `og:site_name`, `og:locale`, `og:image` (+ `:width/:height/:alt`);
   `twitter:card=summary_large_image`, `twitter:title/description/image`.
2. Create a 1200×630 branded share image (`public/og-default.png`),
   `apple-touch-icon.png` (180×180), and `site.webmanifest`.
3. Add JSON-LD to church pages: `Church` (PlaceOfWorship) with name, address,
   geo, and url; plus `BreadcrumbList`.
4. Add `WebSite` + `SearchAction` JSON-LD to the homepage.

### Phase 2 — Titles, headings & SPA meta

5. Rework title/description templates to front-load intent + location:
   - Church title: `Mass, Confession & Adoration Times — {Name}, {City}, {State} | Project Carlo`
   - Description: include day coverage + city.
6. Use React 19 native document metadata (`<title>`/`<meta>`/`<link>` rendered
   in route components auto-hoist to `<head>` — no react-helmet needed). Add
   per-route title, description, and correct canonical to `HomePage`,
   `LandingPage`, `AboutPage`, `NotFoundPage`, and the client-rendered
   `ChurchPage`.
7. Promote church name to a single `<h1>` in `ChurchPageContent.tsx`.

### Phase 3 — Local long-tail expansion

8. Generate prerendered city/region pages (e.g. `/mass-times/{state}/{city}/`)
   listing every parish in that city; add to sitemap; link from breadcrumbs.
9. Optional: dynamic per-page OG images at build (satori + `@resvg/resvg-js`)
   showing parish name + city + next Mass time.

### Phase 4 — Polish & measurement

10. Verify Core Web Vitals; extend font preloading to the home page.
11. Submit `sitemap.xml` to Google Search Console + Bing Webmaster Tools.
12. Validate with the Rich Results Test, Facebook Sharing Debugger, and Schema
    Markup Validator.

## Progress

- [x] Phase 1 — social previews & metadata foundation
  - OG + Twitter tags on `index.html` and `StaticChurchPage.tsx`
  - `og-default.png`, `apple-touch-icon.png`, `icon-192/512.png`, `site.webmanifest`
    (regenerate via `pnpm --filter web og:gen`, source in `scripts/generate-og.ts`)
  - JSON-LD: `Church` + `BreadcrumbList` (church pages), `WebSite` + `Organization` (home)
  - SearchAction deferred to Phase 2 (needs a real `?q=` search handler first)
- [x] Phase 2 — titles, headings & SPA meta
  - Keyword-forward title/description builders in `src/lib/seo.ts`
    (`buildChurchTitle`, `buildChurchDescription`, `HOME_TITLE`, `HOME_DESCRIPTION`)
  - `useDocumentMeta` hook upserts title/description/canonical/og/twitter on
    client navigation; wired into Home, Landing, About, NotFound (noindex), and
    the client-rendered ChurchPage — fixes the shell canonical leaking onto `/landing`
  - Church name promoted to `<h1>`; service sections to `<h2>`
- [x] Phase 2.5 — technical SEO hardening
  - `WebPage` JSON-LD with `dateModified` (same source as sitemap `<lastmod>`).
    Recurring schedules remain visible page content rather than `Event` JSON-LD:
    Google requires each structured Event to have a unique leaf URL on a page
    focused on that concrete event, which multi-event parish pages do not meet.
  - Prerendered `/churches/` all-parishes index page (grouped by city) — gives
    crawlers an internal-link path to all church pages instead of sitemap-only
    discovery; linked from every church page footer, included in the sitemap,
    and added as a "Parishes" breadcrumb level.
  - Homepage `<h1>` now carries the intent keywords (Masthead tagline);
    the wordmark is a styled `<p>` — visually unchanged.
  - WebSite/Organization JSON-LD injected into `index.html` at build time from
    `src/lib/seo.ts` (single source of truth); JSON-LD serialization escapes
    `<` to keep `</script>`-safe.
- [ ] Phase 3 — local long-tail expansion
- [ ] Phase 4 — polish & measurement (submit sitemap to Google Search Console
      + Bing Webmaster Tools after the next deploy; validate with the Rich
      Results Test and Facebook Sharing Debugger — zero-code, do first)
