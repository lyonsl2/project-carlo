/** Creates a Stripe Checkout session for the signed-in user.
 *
 *  POST { plan: "monthly" | "annual", successPath?: string, cancelPath?: string }
 *   ->  { url }
 *
 *  Requires a valid Supabase JWT (verify_jwt stays at its default of true).
 */

import { requireEnv } from "../_shared/env.ts";
import { HttpError, jsonResponse, readJsonBody, withJsonApi } from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";
import { getStripe } from "../_shared/stripe.ts";
import { isPlanKey, PLAN_KEYS, priceIdForPlan } from "../_shared/plans.ts";
import { siteUrlFor } from "../_shared/urls.ts";
import {
  ensureStripeCustomer,
  SUPABASE_USER_ID_METADATA_KEY,
} from "../_shared/customers.ts";

/** Mirrors has_active_subscription() in the billing migration. */
const ENTITLED_STATUSES = ["active", "trialing", "past_due"];

const DEFAULT_SUCCESS_PATH = "/account";
const DEFAULT_CANCEL_PATH = "/account";

Deno.serve(withJsonApi(async (req) => {
  const user = await requireUser(req);
  const body = await readJsonBody(req);

  if (!isPlanKey(body.plan)) {
    throw new HttpError(
      400,
      "invalid_plan",
      `plan must be one of: ${PLAN_KEYS.join(", ")}`,
    );
  }

  const siteUrl = requireEnv("SITE_URL");
  const admin = createServiceClient();
  const stripe = getStripe();

  // Sending an existing subscriber to Checkout would quietly sell them a second
  // subscription. Point them at the billing portal instead.
  const { data: active, error: activeError } = await admin
    .from("subscriptions")
    .select("id")
    .eq("user_id", user.id)
    .in("status", ENTITLED_STATUSES)
    .limit(1);

  if (activeError) {
    throw new Error(`Checking existing subscription: ${activeError.message}`);
  }
  if (active && active.length > 0) {
    throw new HttpError(
      409,
      "already_subscribed",
      "You already have an active subscription.",
    );
  }

  const customerId = await ensureStripeCustomer(admin, stripe, user);

  const successUrl = siteUrlFor(body.successPath, siteUrl, DEFAULT_SUCCESS_PATH);
  const cancelUrl = siteUrlFor(body.cancelPath, siteUrl, DEFAULT_CANCEL_PATH);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: [{ price: priceIdForPlan(body.plan), quantity: 1 }],
    success_url: `${successUrl}${successUrl.includes("?") ? "&" : "?"}checkout=success`,
    cancel_url: `${cancelUrl}${cancelUrl.includes("?") ? "&" : "?"}checkout=cancelled`,
    client_reference_id: user.id,
    // Belt and braces for the webhook: whichever object it receives first
    // carries the user id, so it never has to guess.
    subscription_data: {
      metadata: { [SUPABASE_USER_ID_METADATA_KEY]: user.id },
    },
    allow_promotion_codes: true,
  });

  if (!session.url) {
    throw new Error(`Stripe returned a checkout session with no URL: ${session.id}`);
  }

  return jsonResponse({ url: session.url }, 200);
}));
