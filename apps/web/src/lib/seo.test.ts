import { describe, expect, it } from "vitest";
import type { ChurchDetail } from "../types";
import { churchJsonLd } from "./seo";

const church: ChurchDetail = {
  id: 1,
  parish_id: 10,
  slug: "st-charles-borromeo",
  name: "St. Charles Borromeo",
  address_line1: "3003 Dewey Ave",
  address_line2: null,
  city: "Rochester",
  state: "NY",
  postal_code: "14616",
  latitude: 43.228,
  longitude: -77.647,
  homepage_url: "https://stcharlesgreece.org",
  bulletin_url: null,
};

describe("churchJsonLd", () => {
  it("emits the parish as Church structured data", () => {
    expect(
      churchJsonLd(
        church,
        "https://projectcarlo.com/churches/st-charles-borromeo/",
      ),
    ).toMatchObject({
      "@context": "https://schema.org",
      "@type": "Church",
      name: "St. Charles Borromeo",
      address: {
        "@type": "PostalAddress",
        streetAddress: "3003 Dewey Ave",
        addressLocality: "Rochester",
        addressRegion: "NY",
        postalCode: "14616",
        addressCountry: "US",
      },
    });
  });

  it("does not classify a recurring parish schedule as Event structured data", () => {
    const jsonLd = churchJsonLd(
      church,
      "https://projectcarlo.com/churches/st-charles-borromeo/",
    );

    expect(jsonLd).not.toHaveProperty("event");
    expect(JSON.stringify(jsonLd)).not.toContain('"@type":"Event"');
  });
});
