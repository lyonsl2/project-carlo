import { readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import initSqlJs from "sql.js";
import { getAllChurchSlugs, getChurchDetail, getChurchEvents } from "../src/prerender/queries";
import { StaticChurchPage } from "../src/prerender/StaticChurchPage";

const WEB_DIR = resolve(import.meta.dirname, "..");
const DIST_DIR = resolve(WEB_DIR, "dist");
const DB_PATH = resolve(WEB_DIR, "public", "frontend.db");

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

async function main() {
  const SQL = await initSqlJs();
  const dbBuffer = readFileSync(DB_PATH);
  const db = new SQL.Database(dbBuffer);

  const { cssPath, fontPaths } = discoverAssets();
  const slugs = getAllChurchSlugs(db);

  console.log(`Pre-rendering ${slugs.length} church pages...`);

  let count = 0;
  for (const slug of slugs) {
    const church = getChurchDetail(db, slug);
    const events = getChurchEvents(db, slug);

    const html =
      "<!DOCTYPE html>" +
      renderToStaticMarkup(
        createElement(StaticChurchPage, { church, events, cssPath, fontPaths }),
      );

    const outDir = resolve(DIST_DIR, "churches", slug);
    mkdirSync(outDir, { recursive: true });
    writeFileSync(resolve(outDir, "index.html"), html, "utf-8");
    count++;
  }

  db.close();
  console.log(`Pre-rendered ${count} church pages.`);
}

main();
