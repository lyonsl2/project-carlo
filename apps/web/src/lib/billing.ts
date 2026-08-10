/** Turns raw Stripe-derived rows into the handful of states the account page
 *  actually renders. Pure so the edge cases — a cancellation that has not taken
 *  effect yet, a card that failed, an account with several old subscriptions —
 *  can be tested without a browser or a Stripe account. */

export interface SubscriptionSummary {
  id: string;
  status: string;
  cancelAtPeriodEnd: boolean;
  currentPeriodEnd: string | null;
  trialEnd: string | null;
  endedAt: string | null;
  createdAt: string;
}

export interface Entitlements {
  isPatron: boolean;
  savedCount: number;
  /** null means unlimited. */
  savedLimit: number | null;
}

/** Mirrors has_active_subscription() in supabase/migrations. */
export const ENTITLED_STATUSES = ["active", "trialing", "past_due"] as const;

export type BillingState =
  | { kind: "none" }
  | { kind: "active"; renewsAt: string | null }
  | { kind: "trialing"; renewsAt: string | null; trialEndsAt: string | null }
  | { kind: "canceling"; endsAt: string | null }
  | { kind: "pastDue"; retriesUntil: string | null }
  | { kind: "ended"; status: string; endedAt: string | null };

export function isEntitledStatus(status: string): boolean {
  return (ENTITLED_STATUSES as readonly string[]).includes(status);
}

/** An account accumulates a row per subscription it has ever had, so pick the
 *  one that matters: whichever is currently entitled, or failing that the most
 *  recent, which is what a returning subscriber wants to read about. */
export function pickPrimarySubscription(
  subscriptions: readonly SubscriptionSummary[],
): SubscriptionSummary | null {
  if (subscriptions.length === 0) return null;

  const byNewest = [...subscriptions].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  return byNewest.find((s) => isEntitledStatus(s.status)) ?? byNewest[0];
}

export function toBillingState(
  subscription: SubscriptionSummary | null,
): BillingState {
  if (!subscription) return { kind: "none" };

  const { status, cancelAtPeriodEnd, currentPeriodEnd, trialEnd, endedAt } =
    subscription;

  // A cancellation scheduled for the end of the period is still an active
  // subscription to Stripe, but it is the one thing the user most needs told.
  if (cancelAtPeriodEnd && (status === "active" || status === "trialing")) {
    return { kind: "canceling", endsAt: currentPeriodEnd };
  }

  switch (status) {
    case "active":
      return { kind: "active", renewsAt: currentPeriodEnd };
    case "trialing":
      return { kind: "trialing", renewsAt: currentPeriodEnd, trialEndsAt: trialEnd };
    case "past_due":
      return { kind: "pastDue", retriesUntil: currentPeriodEnd };
    default:
      return { kind: "ended", status, endedAt: endedAt ?? currentPeriodEnd };
  }
}

export function remainingSaves(entitlements: Entitlements): number | null {
  if (entitlements.savedLimit === null) return null;
  return Math.max(0, entitlements.savedLimit - entitlements.savedCount);
}

export function canSaveMore(entitlements: Entitlements): boolean {
  const remaining = remainingSaves(entitlements);
  return remaining === null || remaining > 0;
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
