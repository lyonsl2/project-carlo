import type { ChurchIndexEntry } from "./queries";
import {
  CHURCH_INDEX_TITLE,
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  SITE_LOCALE,
  SITE_NAME,
  absoluteUrl,
  buildChurchIndexDescription,
  serializeJsonLd,
} from "../lib/seo";

interface StaticChurchIndexPageProps {
  churches: ChurchIndexEntry[];
  cssPath: string;
  fontPaths: string[];
  canonicalUrl: string;
  /** ISO date (YYYY-MM-DD) — latest parish bulletin date site-wide. */
  lastModified: string;
}

interface CityGroup {
  label: string;
  churches: ChurchIndexEntry[];
}

const UNKNOWN_CITY = "Other locations";

/** Group churches by "City, ST" (alphabetical), with unknown locations last. */
function groupByCity(churches: ChurchIndexEntry[]): CityGroup[] {
  const groups = new Map<string, ChurchIndexEntry[]>();
  for (const church of churches) {
    const city = church.city?.trim();
    const label = city
      ? church.state?.trim()
        ? `${city}, ${church.state.trim()}`
        : city
      : UNKNOWN_CITY;
    const group = groups.get(label);
    if (group) group.push(church);
    else groups.set(label, [church]);
  }
  return [...groups.entries()]
    .sort(([a], [b]) =>
      a === UNKNOWN_CITY ? 1 : b === UNKNOWN_CITY ? -1 : a.localeCompare(b),
    )
    .map(([label, entries]) => ({
      label,
      churches: entries.sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    }));
}

export function StaticChurchIndexPage({
  churches,
  cssPath,
  fontPaths,
  canonicalUrl,
  lastModified,
}: StaticChurchIndexPageProps) {
  const title = CHURCH_INDEX_TITLE;
  const description = buildChurchIndexDescription(churches.length);
  const origin = new URL(canonicalUrl).origin;
  const ogImageUrl = absoluteUrl(origin, OG_IMAGE_PATH);
  const groups = groupByCity(churches);

  const jsonLd = [
    {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      "@id": `${canonicalUrl}#webpage`,
      url: canonicalUrl,
      name: title,
      description,
      dateModified: lastModified,
      inLanguage: "en-US",
    },
    {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: SITE_NAME,
          item: absoluteUrl(origin, "/"),
        },
        {
          "@type": "ListItem",
          position: 2,
          name: "Parishes",
          item: canonicalUrl,
        },
      ],
    },
  ];

  return (
    <html lang="en">
      <head>
        <meta charSet="UTF-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0, viewport-fit=cover"
        />
        <meta name="description" content={description} />
        <meta name="theme-color" content="#F3ECD8" />
        <meta name="color-scheme" content="light" />
        <link rel="icon" type="image/svg+xml" href="/favicon.svg" />
        <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
        <link rel="manifest" href="/site.webmanifest" />
        <link rel="canonical" href={canonicalUrl} />
        <title>{title}</title>

        <meta property="og:type" content="website" />
        <meta property="og:site_name" content={SITE_NAME} />
        <meta property="og:locale" content={SITE_LOCALE} />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={description} />
        <meta property="og:url" content={canonicalUrl} />
        <meta property="og:image" content={ogImageUrl} />
        <meta property="og:image:width" content={String(OG_IMAGE_WIDTH)} />
        <meta property="og:image:height" content={String(OG_IMAGE_HEIGHT)} />
        <meta property="og:image:alt" content={OG_IMAGE_ALT} />

        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={description} />
        <meta name="twitter:image" content={ogImageUrl} />

        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(jsonLd) }}
        />
        {fontPaths.map((fp) => (
          <link
            key={fp}
            rel="preload"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
            href={fp}
          />
        ))}
        <link rel="stylesheet" href={cssPath} />
      </head>
      <body className="bg-paper">
        <main className="mx-auto w-full max-w-3xl px-6 py-12 pb-[calc(3rem+var(--safe-area-inset-bottom))]">
          <header className="text-center">
            <a href="/" className="rubric-link smallcaps text-[0.875rem]">
              Back to map
            </a>
            <h1 className="mt-6 font-display text-[clamp(2rem,5vw,3rem)] leading-[1.05] font-normal tracking-tight text-ink">
              All parishes
            </h1>
            <p className="mt-4 font-serif text-[0.95rem] text-ink-soft">
              Mass, Confession &amp; Adoration times at {churches.length} Catholic
              parishes, parsed from each parish&rsquo;s weekly bulletin.
            </p>
          </header>

          <div className="mt-12 space-y-10">
            {groups.map((group) => (
              <section key={group.label}>
                <h2 className="smallcaps border-b border-rule-strong pb-2 text-[0.95rem] text-ink">
                  {group.label}
                </h2>
                <ul className="mt-4 space-y-2">
                  {group.churches.map((church) => (
                    <li key={church.slug}>
                      <a
                        href={`/churches/${encodeURIComponent(church.slug)}/`}
                        className="rubric-link font-serif text-[1.05rem] text-ink"
                      >
                        {church.name ?? "Unnamed parish"}
                      </a>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </main>
      </body>
    </html>
  );
}
