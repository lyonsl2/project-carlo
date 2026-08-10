/** Starts, or restarts, a subscription for the signed-in user.
 *
 *  POST { plan: "monthly" | "annual", successPath?: string, cancelPath?: string }
 *   ->  { url, action }
 *
 *  Every session this returns collects a payment method. What it does with it
 *  depends on what the account already has: a first-time visitor gets a trial
 *  that only charges when it ends, someone partway through a card-free trial
 *  keeps the days they have left, and someone whose subscription Stripe paused
 *  gets a card form that resumes it. See _shared/checkoutAction.ts.
 *
 *  Nothing here creates a Stripe customer. For an account Stripe has never seen
 *  the session carries an email instead, and Checkout mints the customer only
 *  once the session completes — so abandoning the card form leaves no trace in
 *  Stripe. The card-free trial reaches this function not at all: it is a row in
 *  public.trials, written by public.start_trial().
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
  findStripeCustomerId,
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

  const [existing, trialEndsAt] = await Promise.all([
    readSubscriptions(admin, user.id),
    readTrialEnd(admin, user.id),
  ]);

  const action: CheckoutAction = decideCheckoutAction(existing, trialEndsAt);

  if (action.kind === "alreadySubscribed") {
    throw new HttpError(
      409,
      "already_subscribed",
      "You already have an active subscription.",
    );
  }

  // Present only for an account that has completed a checkout before. A first
  // one deliberately has no customer to reuse.
  const customerId = await findStripeCustomerId(admin, user.id);
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
    if (!customerId) {
      // A paused subscription cannot exist without the webhook having recorded
      // the customer, so this is a broken mapping rather than a new visitor.
      throw new Error(
        `No Stripe customer for user ${user.id} with a paused subscription`,
      );
    }
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
    params = {
      mode: "subscription",
      // One or the other, never both: Stripe rejects a session carrying an
      // email for a customer it already has.
      ...(customerId
        ? { customer: customerId }
        : { customer_email: user.email ?? undefined }),
      line_items: [{ price: priceIdForPlan(body.plan), quantity: 1 }],
      success_url: successUrl,
      cancel_url: cancelUrl,
      client_reference_id: user.id,
      allow_promotion_codes: true,
      // Stripe's default, stated because it is the whole point: nothing is
      // due today during a trial, so the alternative — `if_required` — skips
      // the card form and hands out a trial nobody can be charged for.
      payment_method_collection: "always",
      subscription_data: {
        // Belt and braces for the webhook: whichever object it receives first
        // carries the user id, so it never has to guess.
        metadata: { [SUPABASE_USER_ID_METADATA_KEY]: user.id },
        ...(action.kind === "startTrial" ? trialParams(action.trialEndsAt) : {}),
      },
    };
  }

  const session = await stripe.checkout.sessions.create(params);

  if (!session.url) {
    throw new Error(`Stripe returned a checkout session with no URL: ${session.id}`);
  }

  return jsonResponse({ url: session.url, action: action.kind }, 200);
}));

/** A fresh trial is measured in days from now; continuing a card-free one is
 *  pinned to the date that trial already has, so a card cannot buy extra days.
 *
 *  `pause` on a missing payment method is a safety net rather than the main
 *  path now that Checkout always collects a card: it covers the subscriber who
 *  removes their card through the Billing Portal mid-trial, whose subscription
 *  is then parked rather than cancelled and can be resumed later. */
function trialParams(
  trialEndsAt: string | null,
): Pick<
  Stripe.Checkout.SessionCreateParams.SubscriptionData,
  "trial_period_days" | "trial_end" | "trial_settings"
> {
  return {
    ...(trialEndsAt
      ? { trial_end: Math.floor(new Date(trialEndsAt).getTime() / 1000) }
      : { trial_period_days: TRIAL_PERIOD_DAYS }),
    trial_settings: {
      end_behavior: { missing_payment_method: "pause" as const },
    },
  };
}

async function readSubscriptions(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<ExistingSubscription[]> {
  const { data, error } = await admin
    .from("subscriptions")
    .select("id, status, first_paid_at, created_at")
    .eq("user_id", userId);

  if (error) throw new Error(`Reading existing subscriptions: ${error.message}`);
  return (data ?? []) as ExistingSubscription[];
}

async function readTrialEnd(
  admin: ReturnType<typeof createServiceClient>,
  userId: string,
): Promise<string | null> {
  const { data, error } = await admin
    .from("trials")
    .select("ends_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw new Error(`Reading the card-free trial: ${error.message}`);
  return data?.ends_at ?? null;
}
