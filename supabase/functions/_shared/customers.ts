/** Lookups that tie a Supabase user to a Stripe customer.
 *
 *  Nothing here creates a customer. Stripe mints one when a Checkout session
 *  completes, and the webhook records the mapping — so an account that starts
 *  checkout and walks away leaves nothing behind in either system.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/** Stamped on the subscription and the setup intent we ask Stripe to create,
 *  and backfilled onto the customer itself by tagCustomerWithUserId, so the
 *  mapping survives even if the stripe_customers row is lost or the customer is
 *  reached from Stripe's side first (a webhook for a subscription started in the
 *  dashboard, say). */
export const SUPABASE_USER_ID_METADATA_KEY = "supabase_user_id";

export async function findStripeCustomerId(
  admin: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("stripe_customers")
    .select("stripe_customer_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Looking up Stripe customer: ${error.message}`);
  return data?.stripe_customer_id ?? null;
}

export function stripeCustomerMetadataUserId(
  customer: Stripe.Customer | Stripe.DeletedCustomer,
): string | null {
  if (customer.deleted) return null;
  const value = customer.metadata?.[SUPABASE_USER_ID_METADATA_KEY];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export async function findUserIdForCustomer(
  admin: SupabaseClient,
  stripeCustomerId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("stripe_customers")
    .select("user_id")
    .eq("stripe_customer_id", stripeCustomerId)
    .maybeSingle();

  if (error) throw new Error(`Looking up user for customer: ${error.message}`);
  return data?.user_id ?? null;
}

export async function linkCustomerToUser(
  admin: SupabaseClient,
  userId: string,
  stripeCustomerId: string,
): Promise<void> {
  const { error } = await admin
    .from("stripe_customers")
    .upsert({ user_id: userId, stripe_customer_id: stripeCustomerId }, {
      onConflict: "user_id",
    });
  if (error) throw new Error(`Linking Stripe customer: ${error.message}`);
}

/** Writes the Supabase user id onto a Stripe customer Checkout created for us.
 *
 *  Best effort by design: this only exists to make findUserIdForCustomer's last
 *  resort work, and a webhook must not fail — and be retried forever — over a
 *  bookkeeping write.
 */
export async function tagCustomerWithUserId(
  stripe: Stripe,
  stripeCustomerId: string,
  userId: string,
): Promise<void> {
  try {
    await stripe.customers.update(stripeCustomerId, {
      metadata: { [SUPABASE_USER_ID_METADATA_KEY]: userId },
    });
  } catch (error) {
    console.error(`Could not tag customer ${stripeCustomerId}: ${error}`);
  }
}
