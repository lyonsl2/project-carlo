/** Lookups that tie a Supabase user to a Stripe customer. */

import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";

/** Set on every Stripe customer we create, so the mapping survives even if the
 *  stripe_customers row is lost or the customer is reached from Stripe's side
 *  first (a webhook for a subscription started in the dashboard, say). */
export const SUPABASE_USER_ID_METADATA_KEY = "supabase_user_id";

const UNIQUE_VIOLATION = "23505";

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

/** Returns the user's Stripe customer, creating it on first use.
 *
 *  Two checkouts started at once would otherwise create two customers for the
 *  same person, so the insert is allowed to lose the race and re-read. */
export async function ensureStripeCustomer(
  admin: SupabaseClient,
  stripe: Stripe,
  user: { id: string; email?: string | null },
): Promise<string> {
  const existing = await findStripeCustomerId(admin, user.id);
  if (existing) return existing;

  const customer = await stripe.customers.create({
    email: user.email ?? undefined,
    metadata: { [SUPABASE_USER_ID_METADATA_KEY]: user.id },
  });

  const { error } = await admin
    .from("stripe_customers")
    .insert({ user_id: user.id, stripe_customer_id: customer.id });

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      const winner = await findStripeCustomerId(admin, user.id);
      if (winner) {
        // Another request got there first. Leave the duplicate customer behind
        // rather than deleting it: it has no subscription attached and Stripe
        // keeps it out of the way, whereas a wrong delete is unrecoverable.
        console.warn(
          `Discarding duplicate Stripe customer ${customer.id} for user ${user.id}`,
        );
        return winner;
      }
    }
    throw new Error(`Saving Stripe customer: ${error.message}`);
  }

  return customer.id;
}
