import { MemoryRouter } from "react-router-dom";
import type { ChurchDetail, EventSummary } from "../types";
import { ChurchPageContent } from "../components/ChurchPageContent";
import {
  OG_IMAGE_ALT,
  OG_IMAGE_HEIGHT,
  OG_IMAGE_PATH,
  OG_IMAGE_WIDTH,
  SITE_LOCALE,
  SITE_NAME,
  absoluteUrl,
  buildChurchDescription,
  buildChurchTitle,
  churchBreadcrumbJsonLd,
  churchJsonLd,
  churchWebPageJsonLd,
  serializeJsonLd,
} from "../lib/seo";

interface StaticChurchPageProps {
  church: ChurchDetail;
  events: EventSummary[];
  cssPath: string;
  fontPaths: string[];
  canonicalUrl: string;
  /** ISO date (YYYY-MM-DD) the parish's data was last updated, if known. */
  lastModified: string | null;
}

export function StaticChurchPage({
  church,
  events,
  cssPath,
  fontPaths,
  canonicalUrl,
  lastModified,
}: StaticChurchPageProps) {
  const title = buildChurchTitle(church);
  const description = buildChurchDescription(church);

  const origin = new URL(canonicalUrl).origin;
  const ogImageUrl = absoluteUrl(origin, OG_IMAGE_PATH);
  const jsonLd = [
    churchJsonLd(church, events, canonicalUrl),
    churchWebPageJsonLd(church, canonicalUrl, lastModified),
    churchBreadcrumbJsonLd(church, canonicalUrl),
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
      <body>
        <MemoryRouter>
          <ChurchPageContent church={church} events={events} />
        </MemoryRouter>
      </body>
    </html>
  );
}
