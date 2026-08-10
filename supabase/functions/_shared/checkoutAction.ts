/** Decides what a "subscribe" click should actually do, given what the account
 *  already has in Stripe.
 *
 *  There are four cases and getting them wrong is expensive in both directions:
 *  sending an existing subscriber to Checkout sells them a second subscription,
 *  and offering a fresh trial to someone who has already had one gives the
 *  product away. Kept pure so all four are covered by tests.
 */

export interface ExistingSubscription {
  id: string;
  status: string;
  first_paid_at: string | null;
  created_at: string;
}

export type CheckoutAction =
  | { kind: "alreadySubscribed" }
  /** The trial ended without a card, so Stripe paused it. Collect a payment
   *  method and resume the same subscription rather than starting a new one. */
  | { kind: "collectCard"; subscriptionId: string }
  | { kind: "startTrial" }
  /** They have subscribed before, so no second trial. */
  | { kind: "subscribeWithoutTrial" };

/** Mirrors public.has_access() in supabase/migrations. Both have to agree: the
 *  database decides who may use the product, this decides what to sell them. */
export function isEntitled(subscription: ExistingSubscription): boolean {
  if (subscription.status === "trialing" || subscription.status === "active") {
    return true;
  }
  return subscription.status === "past_due" && subscription.first_paid_at !== null;
}

export function decideCheckoutAction(
  subscriptions: readonly ExistingSubscription[],
): CheckoutAction {
  if (subscriptions.some(isEntitled)) return { kind: "alreadySubscribed" };

  const newestFirst = [...subscriptions].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  const paused = newestFirst.find((s) => s.status === "paused");
  if (paused) return { kind: "collectCard", subscriptionId: paused.id };

  if (newestFirst.length === 0) return { kind: "startTrial" };

  return { kind: "subscribeWithoutTrial" };
}
