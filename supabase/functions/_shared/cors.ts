/** CORS for the browser-facing functions.
 *
 *  The origin is echoed back only when it appears in ALLOWED_ORIGINS, rather
 *  than replying `*`. These endpoints are authenticated and create billing
 *  sessions, so a wildcard would let any page on the internet drive them with a
 *  token it had somehow obtained.
 */

const ALLOWED_HEADERS = "authorization, x-client-info, apikey, content-type";

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((origin) => origin.trim().replace(/\/+$/, ""))
    .filter((origin) => origin.length > 0);
}

/** Returns the origin to echo in Access-Control-Allow-Origin, or null to omit
 *  the header entirely (which makes the browser reject the response). */
export function resolveAllowedOrigin(
  requestOrigin: string | null,
  allowList: string[],
): string | null {
  if (!requestOrigin) return null;
  const normalized = requestOrigin.replace(/\/+$/, "");
  return allowList.includes(normalized) ? normalized : null;
}

export function corsHeaders(allowedOrigin: string | null): Record<string, string> {
  if (!allowedOrigin) return {};
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": ALLOWED_HEADERS,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Max-Age": "86400",
    // Shared caches must not serve one origin's response to another.
    Vary: "Origin",
  };
}

export function corsHeadersForRequest(req: Request): Record<string, string> {
  const allowList = parseAllowedOrigins(Deno.env.get("ALLOWED_ORIGINS"));
  return corsHeaders(resolveAllowedOrigin(req.headers.get("Origin"), allowList));
}
