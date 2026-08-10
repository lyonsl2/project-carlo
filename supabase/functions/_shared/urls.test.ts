import { assertEquals } from "jsr:@std/assert@^1";
import { siteUrlFor } from "./urls.ts";

const SITE = "https://projectcarlo.com";

Deno.test("resolves a relative path against the configured site", () => {
  assertEquals(siteUrlFor("/account", SITE, "/"), "https://projectcarlo.com/account");
  assertEquals(
    siteUrlFor("/churches/st-marys-corning/?saved=1", SITE, "/"),
    "https://projectcarlo.com/churches/st-marys-corning/?saved=1",
  );
});

Deno.test("falls back when no path is supplied", () => {
  assertEquals(
    siteUrlFor(undefined, SITE, "/account"),
    "https://projectcarlo.com/account",
  );
  assertEquals(siteUrlFor("", SITE, "/account"), "https://projectcarlo.com/account");
  assertEquals(siteUrlFor(42, SITE, "/account"), "https://projectcarlo.com/account");
});

Deno.test("refuses anything that would redirect off site", () => {
  const offSite = [
    "https://evil.test/phish",
    "//evil.test/phish",
    "/\\evil.test/phish",
    "\\\\evil.test/phish",
    "javascript:alert(1)",
    "account",
    " https://evil.test",
    "/\t/evil.test",
  ];

  for (const path of offSite) {
    assertEquals(
      siteUrlFor(path, SITE, "/account"),
      "https://projectcarlo.com/account",
      `expected ${JSON.stringify(path)} to be rejected`,
    );
  }
});
