/** Decides what a "subscribe" click should actually do, given what the account
 *  already has.
 *
 *  Getting this wrong is expensive in both directions: sending an existing
 *  subscriber to Checkout sells them a second subscription, and offering a
 *  fresh trial to someone who has already had one gives the product away. Kept
 *  pure so every branch is covered by tests.
 */

export interface ExistingSubscription {
  id: string;
  status: string;
  first_paid_at: string | null;
  created_at: string;
}

export type CheckoutAction =
  | { kind: "alreadySubscribed" }
  /** The trial ended without a usable card, so Stripe paused it. Collect a
   *  payment method and resume the same subscription rather than starting a
   *  new one. */
  | { kind: "collectCard"; subscriptionId: string }
  /** Checkout collects a card and the trial runs before the first charge.
   *
   *  `trialEndsAt` is null for a brand new account, which gets the full
   *  TRIAL_PERIOD_DAYS. For someone partway through a card-free trial it is
   *  that trial's end date, handed to Stripe verbatim so adding a card
   *  continues the window they are already in instead of opening a second one. */
  | { kind: "startTrial"; trialEndsAt: string | null }
  /** They have had their trial, so this is a straight subscription. */
  | { kind: "subscribeWithoutTrial" };

/** Stripe rejects `subscription_data.trial_end` less than 48 hours out, so the
 *  tail of a card-free trial cannot be carried across. Someone who leaves it
 *  that late subscribes immediately instead; Stripe's own checkout page states
 *  the amount and the date before they confirm, so nothing is a surprise. */
export const MIN_STRIPE_TRIAL_MS = 48 * 60 * 60 * 1000;

/** Mirrors public.has_access() in supabase/migrations. Both have to agree: the
 *  database decides who may use the product, this decides what to sell them. */
export function isEntitled(subscription: ExistingSubscription): boolean {
  if (subscription.status === "trialing" || subscription.status === "active") {
    return true;
  }
  return subscription.status === "past_due" && subscription.first_paid_at !== null;
}

function millisecondsUntil(iso: string, now: Date): number | null {
  const at = new Date(iso).getTime();
  return Number.isNaN(at) ? null : at - now.getTime();
}

export function decideCheckoutAction(
  subscriptions: readonly ExistingSubscription[],
  /** public.trials.ends_at for this user, or null if they never took one. */
  trialEndsAt: string | null = null,
  now: Date = new Date(),
): CheckoutAction {
  if (subscriptions.some(isEntitled)) return { kind: "alreadySubscribed" };

  const newestFirst = [...subscriptions].sort((a, b) =>
    b.created_at.localeCompare(a.created_at)
  );

  const paused = newestFirst.find((s) => s.status === "paused");
  if (paused) return { kind: "collectCard", subscriptionId: paused.id };

  // Any subscription at all, however dead, means the trial has been had.
  if (newestFirst.length > 0) return { kind: "subscribeWithoutTrial" };

  if (trialEndsAt === null) return { kind: "startTrial", trialEndsAt: null };

  const remaining = millisecondsUntil(trialEndsAt, now);
  if (remaining === null || remaining < MIN_STRIPE_TRIAL_MS) {
    // Either the card-free trial has run out, or too little of it is left for
    // Stripe to honour. Both are an ordinary subscription starting today.
    return { kind: "subscribeWithoutTrial" };
  }

  return { kind: "startTrial", trialEndsAt };
}
