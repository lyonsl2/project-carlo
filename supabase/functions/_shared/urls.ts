/** Turns a caller-supplied return path into an absolute URL on our own site.
 *
 *  Stripe sends the browser to whatever success_url/cancel_url/return_url we
 *  hand it, so accepting a URL from the client verbatim would be an open
 *  redirect with a payment page in front of it. Only a same-site absolute path
 *  is honoured; anything else silently falls back.
 */

function isSafeRelativePath(path: string): boolean {
  if (!path.startsWith("/")) return false;
  // "//evil.test" and "/\evil.test" are both read as protocol-relative URLs by
  // browsers, and a backslash is normalised to a slash before that check.
  const normalized = path.replaceAll("\\", "/");
  if (normalized.startsWith("//")) return false;
  // Control characters can be used to smuggle a scheme past naive checks.
  // deno-lint-ignore no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(path)) return false;
  return true;
}

export function siteUrlFor(path: unknown, siteUrl: string, fallbackPath: string): string {
  const candidate = typeof path === "string" ? path.trim() : "";
  const safePath = candidate && isSafeRelativePath(candidate) ? candidate : fallbackPath;
  return new URL(safePath, siteUrl).toString();
}
