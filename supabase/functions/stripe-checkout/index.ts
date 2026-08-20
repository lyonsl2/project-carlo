/** Starts, or restarts, a subscription for the signed-in user.
 *
 *  POST { plan: "monthly" | "annual", successPath?: string, cancelPath?: string }
 *   ->  { url, action }
 *
 *  What the returned Checkout session does depends on what the account already
 *  has in Stripe — a first-time visitor gets the card-free trial, someone whose
 *  trial ran out gets a card form that resumes the subscription Stripe paused.
 *  See _shared/checkoutAction.ts.
 *
 *  Requires a valid Supabase JWT (verify_jwt stays at its default of true).
 */

import type Stripe from "stripe";
import { requireEnv } from "../_shared/env.ts";
import { HttpError, jsonResponse, readJsonBody, withJsonApi } from "../_shared/http.ts";
import { createServiceClient, requireUser } from "../_shared/supabase.ts";
import { getStripe } from "../_shared/stripe.ts";
import {
  isPlanKey,
  PLAN_KEYS,
  priceIdForPlan,
  TRIAL_PERIOD_DAYS,
} from "../_shared/plans.ts";
import { siteUrlFor } from "../_shared/urls.ts";
import {
  ensureStripeCustomer,
  SUPABASE_USER_ID_METADATA_KEY,
} from "../_shared/customers.ts";
import {
  type CheckoutAction,
  decideCheckoutAction,
  type ExistingSubscription,
} from "../_shared/checkoutAction.ts";

const DEFAULT_SUCCESS_PATH = "/account";
const DEFAULT_CANCEL_PATH = "/account";

/** Read by the webhook when the card comes back, to know which paused
 *  subscription it belongs to. */
export const SUBSCRIPTION_ID_METADATA_KEY = "subscription_id";

function withQuery(url: string, key: string, value: string): string {
  return `${url}${url.includes("?") ? "&" : "?"}${key}=${value}`;
}

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

  const { data: existing, error: existingError } = await admin
    .from("subscriptions")
    .select("id, status, first_paid_at, created_at")
    .eq("user_id", user.id);

  if (existingError) {
    throw new Error(`Reading existing subscriptions: ${existingError.message}`);
  }

  const action: CheckoutAction = decideCheckoutAction(
    (existing ?? []) as ExistingSubscription[],
  );

  if (action.kind === "alreadySubscribed") {
    throw new HttpError(
      409,
      "already_subscribed",
      "You already have an active subscription.",
    );
  }

  const customerId = await ensureStripeCustomer(admin, stripe, user);
  const successUrl = withQuery(
    siteUrlFor(body.successPath, siteUrl, DEFAULT_SUCCESS_PATH),
    "checkout",
    "success",
  );
  const cancelUrl = withQuery(
    siteUrlFor(body.cancelPath, siteUrl, DEFAULT_CANCEL_PATH),
    "checkout",
    "cancelled",
  );

  let params: Stripe.Checkout.SessionCreateParams;

  if (action.kind === "collectCard") {
    // Setup mode collects a payment method without charging. The webhook makes
    // it the customer's default and resumes the paused subscription, so the
    // person keeps the subscription they started rather than a new one.
    params = {
      mode: "setup",
      customer: customerId,
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      setup_intent_data: {
        metadata: {
          [SUBSCRIPTION_ID_METADATA_KEY]: action.subscriptionId,
          [SUPABASE_USER_ID_METADATA_KEY]: user.id,
        },
      },
    };
  } else {
    const startingTrial = action.kind === "startTrial";
    params = {
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceIdForPlan(body.plan), quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      allow_promotion_codes: true,
      // Nothing is due today during a trial, so Stripe skips the card form
      // entirely. This is what makes the trial card-free.
      ...(startingTrial ? { payment_method_collection: "if_required" as const } : {}),
      subscription_data: {
        // Belt and braces for the webhook: whichever object it receives first
        // carries the user id, so it never has to guess.
        metadata: { [SUPABASE_USER_ID_METADATA_KEY]: user.id },
        ...(startingTrial
          ? {
            trial_period_days: TRIAL_PERIOD_DAYS,
            // Without a card at the end of the trial, Stripe parks the
            // subscription instead of cancelling it, so the same subscription
            // can be resumed later.
            trial_settings: {
              end_behavior: { missing_payment_method: "pause" as const },
            },
          }
          : {}),
      },
    };
  }

  const session = await stripe.checkout.sessions.create(params);

  if (!session.url) {
    throw new Error(`Stripe returned a checkout session with no URL: ${session.id}`);
  }

  return jsonResponse({ url: session.url, action: action.kind }, 200);
}));
