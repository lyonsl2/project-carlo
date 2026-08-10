/** Receives Stripe webhooks and mirrors subscription state into Postgres.
 *
 *  Deployed with verify_jwt = false (see supabase/config.toml): Stripe cannot
 *  present a Supabase JWT, and the signature check below is what authenticates
 *  the request instead.
 *
 *  Events to enable on the endpoint:
 *    checkout.session.completed
 *    customer.subscription.created
 *    customer.subscription.updated
 *    customer.subscription.deleted
 *
 *  Invoice events are deliberately not handled. Every state they would tell us
 *  about — a renewal, a failed charge moving the subscription to past_due, a
 *  recovery — also arrives as customer.subscription.updated, and handling both
 *  would mean two paths writing the same row.
 */

import type Stripe from "stripe";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireEnv } from "../_shared/env.ts";
import { createServiceClient } from "../_shared/supabase.ts";
import { cryptoProvider, getStripe } from "../_shared/stripe.ts";
import { stripeIdOf, toSubscriptionRow } from "../_shared/subscription.ts";
import {
  findUserIdForCustomer,
  linkCustomerToUser,
  stripeCustomerMetadataUserId,
} from "../_shared/customers.ts";

const UNIQUE_VIOLATION = "23505";

const HANDLED_EVENTS = new Set([
  "checkout.session.completed",
  "customer.subscription.created",
  "customer.subscription.updated",
  "customer.subscription.deleted",
]);

/** Records the event id so a redelivery can be skipped. Returns false when this
 *  event has already been processed. */
async function claimEvent(
  admin: SupabaseClient,
  event: Stripe.Event,
): Promise<boolean> {
  const { error } = await admin
    .from("stripe_events")
    .insert({ id: event.id, type: event.type });

  if (!error) return true;
  if (error.code === UNIQUE_VIOLATION) return false;
  throw new Error(`Claiming event ${event.id}: ${error.message}`);
}

async function releaseEvent(admin: SupabaseClient, eventId: string): Promise<void> {
  const { error } = await admin.from("stripe_events").delete().eq("id", eventId);
  if (error) {
    // Losing the release means Stripe's retry will be skipped as a duplicate,
    // so make it obvious in the logs rather than failing the response too.
    console.error(`Could not release event ${eventId}: ${error.message}`);
  }
}

/** Works out which Supabase user an event belongs to, trying the cheapest and
 *  most reliable sources first, and backfills the mapping when it finds one. */
async function resolveUserId(
  admin: SupabaseClient,
  stripe: Stripe,
  customerId: string,
  hints: (string | null | undefined)[],
): Promise<string | null> {
  const linked = await findUserIdForCustomer(admin, customerId);
  if (linked) return linked;

  for (const hint of hints) {
    if (hint) {
      await linkCustomerToUser(admin, hint, customerId);
      return hint;
    }
  }

  // Last resort, and the one that covers a subscription started from the Stripe
  // dashboard against a customer we created earlier.
  const customer = await stripe.customers.retrieve(customerId);
  const fromMetadata = stripeCustomerMetadataUserId(customer);
  if (fromMetadata) {
    await linkCustomerToUser(admin, fromMetadata, customerId);
    return fromMetadata;
  }

  return null;
}

async function upsertSubscription(
  admin: SupabaseClient,
  stripe: Stripe,
  subscription: Stripe.Subscription,
): Promise<void> {
  const customerId = stripeIdOf(subscription.customer);
  if (!customerId) {
    console.error(`Subscription ${subscription.id} has no customer; skipping`);
    return;
  }

  const userId = await resolveUserId(admin, stripe, customerId, [
    subscription.metadata?.supabase_user_id,
  ]);

  if (!userId) {
    // Retrying will not conjure a mapping, so acknowledge and leave a trail.
    // This is what a subscription created for a Stripe customer that never went
    // through our checkout looks like.
    console.error(
      `No Supabase user for Stripe customer ${customerId}; ignoring subscription ${subscription.id}`,
    );
    return;
  }

  const row = toSubscriptionRow(subscription, userId);
  const { error } = await admin.from("subscriptions").upsert(row, { onConflict: "id" });
  if (error) {
    throw new Error(`Upserting subscription ${subscription.id}: ${error.message}`);
  }

  console.log(`Subscription ${subscription.id} for user ${userId} is ${row.status}`);
}

async function handleCheckoutCompleted(
  admin: SupabaseClient,
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<void> {
  const customerId = stripeIdOf(session.customer);
  if (customerId) {
    await resolveUserId(admin, stripe, customerId, [session.client_reference_id]);
  }

  if (session.mode !== "subscription") return;

  const subscriptionId = stripeIdOf(session.subscription);
  if (!subscriptionId) {
    console.error(`Checkout session ${session.id} completed without a subscription`);
    return;
  }

  // The session carries only the subscription id, and customer.subscription.created
  // can arrive either side of this event, so fetch the current state rather than
  // trusting whichever arrived first.
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  await upsertSubscription(admin, stripe, subscription);
}

async function handleEvent(
  admin: SupabaseClient,
  stripe: Stripe,
  event: Stripe.Event,
): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(
        admin,
        stripe,
        event.data.object as Stripe.Checkout.Session,
      );
      return;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      // A deleted subscription arrives with status "canceled"; the row is kept
      // rather than removed so the account page can say what happened and when.
      await upsertSubscription(admin, stripe, event.data.object as Stripe.Subscription);
      return;
    default:
      console.log(`Ignoring unhandled event type ${event.type}`);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const signature = req.headers.get("Stripe-Signature");
  if (!signature) {
    return new Response("Missing Stripe-Signature header", { status: 400 });
  }

  // Must be the raw body: signature verification is over the exact bytes Stripe
  // sent, so parsing to JSON first would break it.
  const payload = await req.text();

  const stripe = getStripe();
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(
      payload,
      signature,
      requireEnv("STRIPE_WEBHOOK_SIGNING_SECRET"),
      undefined,
      cryptoProvider,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Rejecting webhook: ${message}`);
    return new Response(`Webhook signature verification failed: ${message}`, {
      status: 400,
    });
  }

  const admin = createServiceClient();

  if (!HANDLED_EVENTS.has(event.type)) {
    // Acknowledge without claiming, so the endpoint stays healthy if extra
    // event types get switched on in the dashboard by mistake.
    return Response.json({ received: true, handled: false });
  }

  let claimed: boolean;
  try {
    claimed = await claimEvent(admin, event);
  } catch (error) {
    console.error(error);
    return new Response("Could not record event", { status: 500 });
  }

  if (!claimed) {
    console.log(`Event ${event.id} already processed; skipping redelivery`);
    return Response.json({ received: true, duplicate: true });
  }

  try {
    await handleEvent(admin, stripe, event);
  } catch (error) {
    // Give the claim back so Stripe's next attempt is not mistaken for a
    // redelivery of work that already succeeded.
    await releaseEvent(admin, event.id);
    console.error(`Handling ${event.type} (${event.id}) failed:`, error);
    return new Response("Event handling failed", { status: 500 });
  }

  return Response.json({ received: true });
});
