import { assertEquals } from "jsr:@std/assert@^1";
import { corsHeaders, parseAllowedOrigins, resolveAllowedOrigin } from "./cors.ts";

Deno.test("parses a comma separated allow list, trimming stray slashes", () => {
  assertEquals(
    parseAllowedOrigins("https://projectcarlo.com/, http://localhost:5173"),
    ["https://projectcarlo.com", "http://localhost:5173"],
  );
});

Deno.test("treats missing or empty configuration as an empty allow list", () => {
  assertEquals(parseAllowedOrigins(undefined), []);
  assertEquals(parseAllowedOrigins(""), []);
  assertEquals(parseAllowedOrigins(" , "), []);
});

Deno.test("echoes an allowed origin back", () => {
  const allowList = ["https://projectcarlo.com"];
  assertEquals(
    resolveAllowedOrigin("https://projectcarlo.com", allowList),
    "https://projectcarlo.com",
  );
});

Deno.test("refuses an origin that is not on the list", () => {
  const allowList = ["https://projectcarlo.com"];
  assertEquals(
    resolveAllowedOrigin("https://projectcarlo.com.evil.test", allowList),
    null,
  );
  assertEquals(resolveAllowedOrigin("http://projectcarlo.com", allowList), null);
  assertEquals(resolveAllowedOrigin(null, allowList), null);
  assertEquals(resolveAllowedOrigin("https://projectcarlo.com", []), null);
});

Deno.test("omits CORS headers entirely when the origin is refused", () => {
  assertEquals(corsHeaders(null), {});
});

Deno.test("varies on Origin so a shared cache cannot cross the streams", () => {
  const headers = corsHeaders("https://projectcarlo.com");
  assertEquals(headers["Access-Control-Allow-Origin"], "https://projectcarlo.com");
  assertEquals(headers["Vary"], "Origin");
});
