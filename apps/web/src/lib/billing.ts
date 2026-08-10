/** Turns the Stripe-derived subscription rows into the handful of states the
 *  account page actually renders.
 *
 *  Pure, so the edge cases — a trial that ran out without a card, a
 *  cancellation that has not taken effect yet, an account with several old
 *  subscriptions — can be tested without a browser or a Stripe account.
 */

export interface SubscriptionSummary {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  endedAt: string | null;
  /** Set the first time Stripe reported this subscription active. */
  firstPaidAt: string | null;
  createdAt: string;
}

/** What `public.account_entitlements()` reports. The verdict on whether someone
 *  may use the site comes from the database, not from re-deriving it here. */
export interface Entitlements {
  hasAccess: boolean;
  savedCount: number;
}

export type BillingState =
  /** Signed in, but has never started a trial or a subscription. */
  | { kind: "none" }
  | { kind: "trialing"; endsAt: string | null }
  /** Stripe parked the subscription because the trial ended with no card. */
  | { kind: "paused" }
  | { kind: "active"; renewsAt: string | null }
  | { kind: "canceling"; endsAt: string | null }
  | { kind: "pastDue"; retriesUntil: string | null; hasPaidBefore: boolean }
  | { kind: "ended"; status: string; endedAt: string | null };

/** Mirrors public.has_access() in supabase/migrations. The database is the one
 *  that decides; this exists so the UI can pick which subscription to talk
 *  about, and the two must not drift. */
export function isEntitledStatus(
  status: string,
  firstPaidAt: string | null = null,
): boolean {
  if (status === "trialing" || status === "active") return true;
  return status === "past_due" && firstPaidAt !== null;
}

/** An account accumulates a row per subscription it has ever had, so pick the
 *  one that matters: whichever is currently entitled, then anything Stripe has
 *  merely paused, and failing both the most recent. */
export function pickPrimarySubscription(
  subscriptions: readonly SubscriptionSummary[],
): SubscriptionSummary | null {
  if (subscriptions.length === 0) return null;

  const byNewest = [...subscriptions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );

  return (
    byNewest.find((s) => isEntitledStatus(s.status, s.firstPaidAt)) ??
    byNewest.find((s) => s.status === "paused") ??
    byNewest[0]
  );
}

export function toBillingState(
  subscription: SubscriptionSummary | null,
): BillingState {
  if (!subscription) return { kind: "none" };

  const {
    status,
    cancelAtPeriodEnd,
    currentPeriodEnd,
    trialEnd,
    endedAt,
    firstPaidAt,
  } = subscription;

  // A cancellation scheduled for the end of the period is still an active
  // subscription to Stripe, but it is the one thing the user most needs told.
  if (cancelAtPeriodEnd && (status === "active" || status === "trialing")) {
    return { kind: "canceling", endsAt: trialEnd ?? currentPeriodEnd };
  }

  switch (status) {
    case "trialing":
      return { kind: "trialing", endsAt: trialEnd ?? currentPeriodEnd };
    case "paused":
      return { kind: "paused" };
    case "active":
      return { kind: "active", renewsAt: currentPeriodEnd };
    case "past_due":
      return {
        kind: "pastDue",
        retriesUntil: currentPeriodEnd,
        hasPaidBefore: firstPaidAt !== null,
      };
    default:
      return { kind: "ended", status, endedAt: endedAt ?? currentPeriodEnd };
  }
}

/** Whole days left, rounded up, so the last few hours still read as "1 day
 *  left" rather than "0 days left". */
export function daysRemaining(
  endsAt: string | null,
  now: Date = new Date(),
): number | null {
  if (!endsAt) return null;
  const end = new Date(endsAt);
  if (Number.isNaN(end.getTime())) return null;

  const remainingMs = end.getTime() - now.getTime();
  if (remainingMs <= 0) return 0;
  return Math.ceil(remainingMs / (24 * 60 * 60 * 1000));
}

export function describeTrialRemaining(
  endsAt: string | null,
  now: Date = new Date(),
): string {
  const days = daysRemaining(endsAt, now);
  if (days === null) return "Your free trial is running";
  if (days === 0) return "Your free trial ends today";
  return days === 1 ? "1 day left in your free trial" : `${days} days left in your free trial`;
}

export function formatBillingDate(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
