/** Whether accounts and billing are switched on, and the credentials to do it.
 *
 *  Kept apart from lib/supabase.ts, which pulls in @supabase/supabase-js: this
 *  module is safe to import from anywhere, including code paths that run with
 *  the feature switched off.
 *
 *  Accounts are a build-time opt-in. With no Supabase project configured the
 *  site is exactly what it was before — no sign-in, no account routes, no
 *  network calls, and the Supabase client never loaded at runtime. That keeps the
 *  public map deployable while the backend is still being set up, and means a
 *  misconfigured build degrades to the free experience rather than showing a
 *  broken sign-in page.
 */

// Each VITE_* read is a literal `import.meta.env.VITE_*` member access on
// purpose. Vite substitutes those textually at build time; wrapping them in a
// helper (or using dynamic lookups) leaves a runtime read that Rollup cannot
// fold, which keeps the account routes and @supabase/supabase-js in the
// accounts-off bundle. `process.env` is the fallback for the tsx prerender
// and for vitest.
function firstNonEmpty(
  fromVite: string | undefined,
  fromNode: string | undefined,
): string | undefined {
  const value = (fromVite ?? fromNode)?.trim();
  return value ? value : undefined;
}

function fromNode(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

/**
 * Build-time flag. Must stay a module-level const (not a function) so that when
 * Vite replaces the unset env vars with `undefined`, Rollup sees `false` and
 * can delete the account-only branches — and with them the Supabase client —
 * from accounts-off builds. A `function isAccountsEnabled() { return false }`
 * is not inlined aggressively enough and still keeps those chunks reachable.
 */
export const ACCOUNTS_ENABLED: boolean = Boolean(
  import.meta.env.VITE_SUPABASE_URL?.trim() &&
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim(),
);

/** Build-time paywall flag. On by default once accounts are configured.
 *  Uses only `import.meta.env` so the accounts-off build can fold this to
 *  `false` without leaving a `process.env` read behind. */
export const PAYWALL_ENABLED: boolean = (() => {
  if (!ACCOUNTS_ENABLED) return false;
  const flag = import.meta.env.VITE_REQUIRE_ACCOUNT?.trim().toLowerCase();
  return flag !== "false" && flag !== "0";
})();

export function getSupabaseUrl(): string | undefined {
  return firstNonEmpty(import.meta.env.VITE_SUPABASE_URL, fromNode("VITE_SUPABASE_URL"));
}

export function getSupabaseAnonKey(): string | undefined {
  return firstNonEmpty(
    import.meta.env.VITE_SUPABASE_ANON_KEY,
    fromNode("VITE_SUPABASE_ANON_KEY"),
  );
}

export function isAccountsEnabled(): boolean {
  return ACCOUNTS_ENABLED;
}

/** Whether the site itself is behind the paywall.
 *
 *  On by default once accounts are configured, because that is the product:
 *  a free 7-day trial and then a subscription. Set VITE_REQUIRE_ACCOUNT=false to
 *  run accounts alongside a public map instead — the sign-in, saved parishes,
 *  and billing all still work, they just stop being a condition of entry.
 */
export function isPaywallEnabled(): boolean {
  return PAYWALL_ENABLED;
}

export function isGoogleSignInEnabled(): boolean {
  const flag = firstNonEmpty(
    import.meta.env.VITE_AUTH_GOOGLE_ENABLED,
    fromNode("VITE_AUTH_GOOGLE_ENABLED"),
  )?.toLowerCase();
  return ACCOUNTS_ENABLED && (flag === "true" || flag === "1");
}
