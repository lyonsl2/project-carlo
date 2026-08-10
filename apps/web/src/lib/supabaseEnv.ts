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
 * Build-time flag, and a module-level const rather than a function so the value
 * is settled before any of the account branches are evaluated.
 *
 * What this buys, measured rather than assumed: with the variables unset, every
 * account branch is dead, so nothing ever calls the lazy imports behind it and
 * index.html preloads none of them — the Supabase client is never fetched. The
 * chunks are still *emitted* into dist/assets; Rollup does not fold the
 * `import.meta.env` reads far enough to drop them. If that dead weight on the
 * CDN ever matters, a `define` entry in vite.config.ts substituting a literal
 * is what would remove it.
 */
export const ACCOUNTS_ENABLED: boolean = Boolean(
  import.meta.env.VITE_SUPABASE_URL?.trim() &&
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim(),
);

/** Build-time paywall flag. On by default once accounts are configured.
 *  Reads only `import.meta.env`, never `process.env`, so the value is fixed at
 *  build time rather than looked up in a browser that has no `process`. */
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
