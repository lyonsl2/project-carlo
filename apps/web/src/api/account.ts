/** Everything the signed-in part of the app reads or writes.
 *
 *  Parish data still comes from the SQLite snapshot in src/api.ts; this module
 *  is only for the per-user rows in Postgres and the two Stripe endpoints.
 */

import type { Entitlements, SubscriptionSummary } from "@/lib/billing";
import type { PlanKey } from "@/lib/plans";
import {
  AccessRequiredError,
  FunctionCallError,
  isPolicyViolation,
  parseFunctionErrorPayload,
} from "@/lib/accountErrors";
import { getSupabaseClient } from "@/lib/supabase";

export { accountKeys } from "./accountKeys";

export async function fetchEntitlements(): Promise<Entitlements> {
  const { data, error } = await getSupabaseClient().rpc("account_entitlements");
  if (error) throw new Error(error.message);

  const row = data?.[0];
  if (!row) throw new Error("account_entitlements returned no row");

  return { hasAccess: row.has_access, savedCount: row.saved_count };
}

export async function fetchSubscriptions(): Promise<SubscriptionSummary[]> {
  const { data, error } = await getSupabaseClient()
    .from("subscriptions")
    .select(
      "id, status, cancel_at_period_end, current_period_end, trial_end, ended_at, first_paid_at, created_at",
    );
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => ({
    id: row.id,
    status: row.status,
    cancelAtPeriodEnd: row.cancel_at_period_end,
    currentPeriodEnd: row.current_period_end,
    trialEnd: row.trial_end,
    endedAt: row.ended_at,
    firstPaidAt: row.first_paid_at,
    createdAt: row.created_at,
  }));
}

export async function fetchSavedChurchSlugs(): Promise<string[]> {
  const { data, error } = await getSupabaseClient()
    .from("saved_churches")
    .select("church_slug")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  return (data ?? []).map((row) => row.church_slug);
}

export async function saveChurch(userId: string, slug: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("saved_churches")
    .insert({ user_id: userId, church_slug: slug });

  if (!error) return;
  // The only policy that can refuse this insert for a correctly authenticated
  // user saving into their own account is the has_access() check, so translate
  // it into something the UI can act on.
  if (isPolicyViolation(error)) throw new AccessRequiredError();
  throw new Error(error.message);
}

export async function unsaveChurch(userId: string, slug: string): Promise<void> {
  const { error } = await getSupabaseClient()
    .from("saved_churches")
    .delete()
    .eq("user_id", userId)
    .eq("church_slug", slug);
  if (error) throw new Error(error.message);
}

async function readFunctionError(error: unknown): Promise<FunctionCallError> {
  const context = (error as { context?: unknown } | null)?.context;
  if (context instanceof Response) {
    try {
      const parsed = parseFunctionErrorPayload(await context.json());
      if (parsed) return new FunctionCallError(parsed.code, parsed.message);
    } catch {
      // Not a JSON error body; fall through to the generic message.
    }
  }
  return new FunctionCallError(
    "unknown",
    error instanceof Error ? error.message : "The request failed.",
  );
}

async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await getSupabaseClient().functions.invoke<T>(name, { body });
  if (error) throw await readFunctionError(error);
  if (!data) throw new FunctionCallError("empty_response", "The request failed.");
  return data;
}

export async function createCheckoutUrl(
  plan: PlanKey,
  paths: { successPath?: string; cancelPath?: string } = {},
): Promise<string> {
  const { url } = await invokeFunction<{ url: string }>("stripe-checkout", {
    plan,
    ...paths,
  });
  return url;
}

export async function createBillingPortalUrl(returnPath?: string): Promise<string> {
  const { url } = await invokeFunction<{ url: string }>("stripe-portal", {
    returnPath,
  });
  return url;
}
