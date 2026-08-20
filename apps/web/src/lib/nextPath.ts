/** Sanitises the ?next= parameter used to return people to where they were
 *  before signing in.
 *
 *  The value reaches us from a query string, and it ends up in a router
 *  navigation and in the emailRedirectTo handed to Supabase, so an absolute URL
 *  slipped in here would be a phishing hop dressed up as a sign-in link.
 */

export const DEFAULT_NEXT_PATH = "/account";

export function safeNextPath(
  value: string | null | undefined,
  fallback: string = DEFAULT_NEXT_PATH,
): string {
  if (typeof value !== "string") return fallback;

  const trimmed = value.trim();
  if (!trimmed.startsWith("/")) return fallback;

  // Browsers read "//host", and "/\host" after normalising the backslash, as
  // protocol-relative URLs pointing somewhere else entirely.
  if (trimmed.replaceAll("\\", "/").startsWith("//")) return fallback;

  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) return fallback;

  return trimmed;
}
