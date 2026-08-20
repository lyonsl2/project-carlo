import { gunzipSync } from "node:zlib";
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import initSqlJs from "sql.js";
import {
  getAllChurchSlugs,
  getAllChurchesForIndex,
  getChurchDetail,
  getChurchEvents,
  getChurchLastModifiedDates,
} from "../src/prerender/queries";
import { StaticChurchPage } from "../src/prerender/StaticChurchPage";
import { StaticChurchIndexPage } from "../src/prerender/StaticChurchIndexPage";
import { CHURCH_INDEX_PATH } from "../src/lib/seo";

const WEB_DIR = resolve(import.meta.dirname, "..");
const DIST_DIR = resolve(WEB_DIR, "dist");
const DB_PATH = resolve(WEB_DIR, "public", "frontend.snapshot");
const SITE_ORIGIN = "https://projectcarlo.com";

/** Font filename prefixes to preload — Latin subsets of the two typefaces used
 *  on church pages (Cardo for display headings, EB Garamond for body text). */
const PRELOAD_FONT_PREFIXES = [
  "cardo-latin-400-normal-",
  "eb-garamond-latin-wght-normal-",
];

function discoverAssets(): { cssPath: string; fontPaths: string[] } {
  const assetsDir = resolve(DIST_DIR, "assets");
  const files = readdirSync(assetsDir);

  const cssFile = files.find((f) => f.startsWith("index-") && f.endsWith(".css"));
  if (!cssFile) {
    throw new Error("Could not find built CSS file in dist/assets/");
  }

  const fontPaths = PRELOAD_FONT_PREFIXES.map((prefix) => {
    const match = files.find((f) => f.startsWith(prefix) && f.endsWith(".woff2"));
    if (!match) throw new Error(`Could not find font file matching ${prefix}*.woff2`);
    return `/assets/${match}`;
  });

  return { cssPath: `/assets/${cssFile}`, fontPaths };
}

function getSiteOrigin(): string {
  return new URL(SITE_ORIGIN).origin;
}

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function absoluteUrl(origin: string, pathname: string): string {
  return new URL(pathname, `${origin}/`).href;
}

function canonicalPathForChurchSlug(slug: string): string {
  return `/churches/${encodeURIComponent(slug)}/`;
}

function canonicalUrlForChurchSlug(origin: string, slug: string): string {
  return absoluteUrl(origin, canonicalPathForChurchSlug(slug));
}

function normalizeLastmodDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;

  const isoPrefix = /^(\d{4}-\d{2}-\d{2})/.exec(trimmed);
  if (isoPrefix) return isoPrefix[1];

  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function maxIsoDate(dates: string[], fallback: string): string {
  if (dates.length === 0) return fallback;
  return dates.reduce((latest, current) => (current > latest ? current : latest), dates[0]);
}

function isAboutPageEnabledAtBuild(): boolean {
  const v = process.env.VITE_ABOUT_PAGE_ENABLED?.trim().toLowerCase();
  return v === "true" || v === "1";
}

/** Mirrors isPaywallEnabled() in src/lib/supabaseEnv.ts, which cannot be
 *  imported here because it reads import.meta.env. */
function isPaywallEnabledAtBuild(): boolean {
  const configured =
    Boolean(process.env.VITE_SUPABASE_URL?.trim()) &&
    Boolean(process.env.VITE_SUPABASE_ANON_KEY?.trim());
  if (!configured) return false;
  const v = process.env.VITE_REQUIRE_ACCOUNT?.trim().toLowerCase();
  return v !== "false" && v !== "0";
}

/** With the site behind a paywall the only page a crawler can reach is the
 *  landing page, so that is the only thing worth advertising. Listing parish
 *  URLs that all redirect to a sign-in earns nothing and reads as a soft 404. */
function writePaywalledSitemapAndRobots(distDir: string, origin: string): number {
  const buildDate = new Date().toISOString().slice(0, 10);
  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `  <url>\n` +
    `    <loc>${escapeXml(absoluteUrl(origin, "/landing"))}</loc>\n` +
    `    <lastmod>${buildDate}</lastmod>\n` +
    `  </url>\n` +
    `</urlset>\n`;
  writeFileSync(resolve(distDir, "sitemap.xml"), sitemap, "utf-8");

  const robots =
    "User-agent: *\n" +
    "Allow: /landing\n" +
    "Disallow: /\n" +
    "\n" +
    `Sitemap: ${absoluteUrl(origin, "/sitemap.xml")}\n`;
  writeFileSync(resolve(distDir, "robots.txt"), robots, "utf-8");

  return 1;
}

function writeSitemapAndRobots(
  distDir: string,
  origin: string,
  slugs: string[],
  lastmodBySlug: Record<string, string | null>,
): number {
  const buildDate = new Date().toISOString().slice(0, 10);
  const churchUrls = slugs.map((slug) => ({
    loc: canonicalUrlForChurchSlug(origin, slug),
    lastmod: normalizeLastmodDate(lastmodBySlug[slug]) ?? buildDate,
  }));
  const homepageLastmod = maxIsoDate(
    churchUrls.map((entry) => entry.lastmod),
    buildDate,
  );
  const urls: { loc: string; lastmod: string }[] = [
    { loc: absoluteUrl(origin, "/"), lastmod: homepageLastmod },
    { loc: absoluteUrl(origin, "/landing"), lastmod: buildDate },
    { loc: absoluteUrl(origin, CHURCH_INDEX_PATH), lastmod: homepageLastmod },
    ...churchUrls,
  ];
  if (isAboutPageEnabledAtBuild()) {
    urls.push({ loc: absoluteUrl(origin, "/about"), lastmod: buildDate });
  }

  const urlEntries = urls
    .map(
      (u) => `  <url>
    <loc>${escapeXml(u.loc)}</loc>
    <lastmod>${u.lastmod}</lastmod>
  </url>`,
    )
    .join("\n");

  const sitemap =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    `${urlEntries}\n` +
    `</urlset>\n`;

  writeFileSync(resolve(distDir, "sitemap.xml"), sitemap, "utf-8");

  const sitemapUrl = absoluteUrl(origin, "/sitemap.xml");
  // The account routes are per-user and behind a sign-in, so there is nothing
  // for a crawler to index and every hit would be a redirect.
  const robots =
    "User-agent: *\n" +
    "Allow: /\n" +
    "Disallow: /account\n" +
    "Disallow: /signin\n" +
    "Disallow: /auth/\n" +
    "\n" +
    `Sitemap: ${sitemapUrl}\n`;

  writeFileSync(resolve(distDir, "robots.txt"), robots, "utf-8");
  return urls.length;
}

async function main() {
  const origin = getSiteOrigin();

  // Prerendered parish pages are the full schedules as static HTML. Behind a
  // paywall they would be the largest hole in it — every one of them readable
  // without an account — so they are simply not written.
  if (isPaywallEnabledAtBuild()) {
    writePaywalledSitemapAndRobots(DIST_DIR, origin);
    console.log(
      "Paywall enabled: skipped parish prerendering, wrote a landing-only sitemap.",
    );
    return;
  }

  const SQL = await initSqlJs();
  const dbBuffer = gunzipSync(readFileSync(DB_PATH));
  const db = new SQL.Database(dbBuffer);

  const { cssPath, fontPaths } = discoverAssets();
  const slugs = getAllChurchSlugs(db);
  const lastmodBySlug = getChurchLastModifiedDates(db);

  console.log(`Pre-rendering ${slugs.length} church pages...`);

  // Same fallback as the sitemap <lastmod>: build date when no bulletin date
  // is known, so JSON-LD dateModified and the sitemap never disagree.
  const buildDate = new Date().toISOString().slice(0, 10);

  let count = 0;
  for (const slug of slugs) {
    const church = getChurchDetail(db, slug);
    const events = getChurchEvents(db, slug);

    const html =
      "<!DOCTYPE html>" +
      renderToStaticMarkup(
        createElement(StaticChurchPage, {
          church,
          events,
          cssPath,
          fontPaths,
          canonicalUrl: canonicalUrlForChurchSlug(origin, slug),
          lastModified: normalizeLastmodDate(lastmodBySlug[slug]) ?? buildDate,
        }),
      );

    const outDir = resolve(DIST_DIR, "churches", slug);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "index.html"), html, "utf-8");
    count++;
  }

  const indexLastmod = maxIsoDate(
    slugs.map((slug) => normalizeLastmodDate(lastmodBySlug[slug]) ?? buildDate),
    buildDate,
  );
  const indexHtml =
    "<!DOCTYPE html>" +
    renderToStaticMarkup(
      createElement(StaticChurchIndexPage, {
        churches: getAllChurchesForIndex(db),
        cssPath,
        fontPaths,
        canonicalUrl: absoluteUrl(origin, CHURCH_INDEX_PATH),
        lastModified: indexLastmod,
      }),
    );
  mkdirSync(resolve(DIST_DIR, "churches"), { recursive: true });
  writeFileSync(resolve(DIST_DIR, "churches", "index.html"), indexHtml, "utf-8");
  console.log("Wrote churches/index.html (all-parishes index).");

  const urlCount = writeSitemapAndRobots(DIST_DIR, origin, slugs, lastmodBySlug);
  console.log(`Wrote sitemap.xml and robots.txt (${urlCount} URLs).`);

  db.close();
  console.log(`Pre-rendered ${count} church pages.`);
}

main();
