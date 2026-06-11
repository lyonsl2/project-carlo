/**
 * Generates raster share/app-icon assets from the brand palette.
 *
 * Social platforms (Facebook, X/Twitter, iMessage, LinkedIn, Slack) do not
 * render SVG for `og:image`, so we rasterize the branded layout to PNG here
 * and commit the output. Re-run with `pnpm --filter web og:gen` when the brand
 * mark or palette changes.
 *
 * OG layout: Option 01 "Missal title page" from docs/share-image-options.html.
 * Rendered via headless Chromium (Playwright) so oklch colors, Cardo small-caps,
 * and paper grain match the design reference — sharp/librsvg cannot reproduce those.
 * Requires Playwright's Chromium: `pnpm --filter web test:e2e:install`.
 *
 * Outputs (into apps/web/public):
 *   - og-default.png      1200x630  link-share preview image
 *   - apple-touch-icon.png 180x180  iOS home-screen icon
 *   - icon-192.png         192x192  web manifest icon
 *   - icon-512.png         512x512  web manifest icon (maskable-safe)
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
import sharp from "sharp";

const WEB_DIR = resolve(import.meta.dirname, "..");
const PUBLIC_DIR = resolve(WEB_DIR, "public");
const OG_TEMPLATE = resolve(import.meta.dirname, "og-template.html");

async function renderOgPng(): Promise<void> {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({
      viewport: { width: 1200, height: 630 },
      deviceScaleFactor: 1,
    });
    await page.goto(pathToFileURL(OG_TEMPLATE).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    await page.locator("#og-frame").screenshot({
      path: resolve(PUBLIC_DIR, "og-default.png"),
      type: "png",
    });
    console.log("Wrote og-default.png (1200x630)");
  } finally {
    await browser.close();
  }
}

async function main() {
  await renderOgPng();

  const favicon = readFileSync(resolve(PUBLIC_DIR, "favicon.svg"));
  const iconSizes = [
    ["apple-touch-icon.png", 180],
    ["icon-192.png", 192],
    ["icon-512.png", 512],
  ] as const;
  for (const [name, size] of iconSizes) {
    await sharp(favicon, { density: 384 })
      .resize(size, size)
      .png()
      .toFile(resolve(PUBLIC_DIR, name));
    console.log(`Wrote ${name} (${size}x${size})`);
  }
}

void main();
