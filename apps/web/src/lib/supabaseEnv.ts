/** Whether accounts and billing are switched on, and the credentials to do it.
 *
 *  Kept apart from lib/supabase.ts, which pulls in @supabase/supabase-js: this
 *  module is safe to import from anywhere, including code paths that run with
 *  the feature switched off.
 *
 *  Accounts are a build-time opt-in. With no Supabase project configured the
 *  site is exactly what it was before — no sign-in, no account routes, no
 *  network calls, and none of the client library in the bundle. That keeps the
 *  public map deployable while the backend is still being set up, and means a
 *  misconfigured build degrades to the free experience rather than showing a
 *  broken sign-in page.
 */

// Each variable is read as a literal member access on purpose. Vite substitutes
// import.meta.env.VITE_* textually at build time and does not touch dynamic
// lookups, and the value is undefined under the tsx-driven prerender, so both
// sources have to be tried. Same pattern as lib/tally.ts.
function firstNonEmpty(
  fromVite: string | undefined,
  fromNode: string | undefined,
): string | undefined {
  const value = (fromVite ?? fromNode)?.trim();
  return value ? value : undefined;
}

function viteEnv(): ImportMetaEnv | undefined {
  return (import.meta as ImportMeta & { env?: ImportMetaEnv }).env;
}

function nodeEnv(): Record<string, string | undefined> | undefined {
  return typeof process !== "undefined" ? process.env : undefined;
}

export function getSupabaseUrl(): string | undefined {
  return firstNonEmpty(viteEnv()?.VITE_SUPABASE_URL, nodeEnv()?.VITE_SUPABASE_URL);
}

export function getSupabaseAnonKey(): string | undefined {
  return firstNonEmpty(
    viteEnv()?.VITE_SUPABASE_ANON_KEY,
    nodeEnv()?.VITE_SUPABASE_ANON_KEY,
  );
}

export function isAccountsEnabled(): boolean {
  return Boolean(getSupabaseUrl() && getSupabaseAnonKey());
}

/** Whether the site itself is behind the paywall.
 *
 *  On by default once accounts are configured, because that is the product:
 *  a free 7-day trial and then a subscription. Set VITE_REQUIRE_ACCOUNT=false to
 *  run accounts alongside a public map instead — the sign-in, saved parishes,
 *  and billing all still work, they just stop being a condition of entry.
 */
export function isPaywallEnabled(): boolean {
  if (!isAccountsEnabled()) return false;
  const flag = firstNonEmpty(
    viteEnv()?.VITE_REQUIRE_ACCOUNT,
    nodeEnv()?.VITE_REQUIRE_ACCOUNT,
  )?.toLowerCase();
  return flag !== "false" && flag !== "0";
}

export function isGoogleSignInEnabled(): boolean {
  const flag = firstNonEmpty(
    viteEnv()?.VITE_AUTH_GOOGLE_ENABLED,
    nodeEnv()?.VITE_AUTH_GOOGLE_ENABLED,
  )?.toLowerCase();
  return isAccountsEnabled() && (flag === "true" || flag === "1");
}
