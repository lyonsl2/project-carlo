/** React Query keys for per-user data.
 *
 *  Separate from api/account.ts so that code which only needs to invalidate the
 *  cache — the session sync, for one — does not drag in the Supabase client.
 */
export const accountKeys = {
  all: ["account"] as const,
  entitlements: () => ["account", "entitlements"] as const,
  subscriptions: () => ["account", "subscriptions"] as const,
  savedChurches: () => ["account", "saved-churches"] as const,
  savedChurchDetails: (slugs: readonly string[] | undefined) =>
    ["account", "saved-church-details", slugs] as const,
};
