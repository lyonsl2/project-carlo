import { MemoryRouter } from "react-router-dom";
import type { ChurchDetail, EventSummary } from "../types";
import { formatAddress } from "../utils";
import { ChurchPageContent } from "../components/ChurchPageContent";

interface StaticChurchPageProps {
  church: ChurchDetail;
  events: EventSummary[];
  cssPath: string;
  fontPaths: string[];
}

export function StaticChurchPage({
  church,
  events,
  cssPath,
  fontPaths,
}: StaticChurchPageProps) {
  const title = church.name
    ? `${church.name} · Project Carlo`
    : "Project Carlo";
  const address = formatAddress(church);
  const description = church.name
    ? `Mass, Confession & Adoration times at ${church.name}${address ? `, ${address}` : ""}`
    : "Mass, Confession & Adoration times";

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
        <title>{title}</title>
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
