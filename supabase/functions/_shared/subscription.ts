/** Translates a Stripe subscription into a row for public.subscriptions.
 *
 *  Kept free of Stripe and Supabase clients so it can be unit tested directly
 *  (see subscription.test.ts) — this mapping is where webhook bugs hide.
 */

export interface StripeSubscriptionItemLike {
  quantity?: number | null;
  current_period_start?: number | null;
  current_period_end?: number | null;
  price?: {
    id?: string | null;
    product?: string | { id?: string | null } | null;
  } | null;
}

export interface StripeSubscriptionLike {
  id: string;
  status: string;
  customer: string | { id?: string | null } | null;
  cancel_at_period_end?: boolean | null;
  trial_end?: number | null;
  canceled_at?: number | null;
  ended_at?: number | null;
  /** Present on API versions before 2025-03-31.basil. */
  current_period_start?: number | null;
  /** Present on API versions before 2025-03-31.basil. */
  current_period_end?: number | null;
  items?: { data?: StripeSubscriptionItemLike[] | null } | null;
}

export interface SubscriptionRow {
  id: string;
  user_id: string;
  stripe_customer_id: string;
  status: string;
  price_id: string | null;
  product_id: string | null;
  quantity: number | null;
  cancel_at_period_end: boolean;
  current_period_start: string | null;
  current_period_end: string | null;
  trial_end: string | null;
  canceled_at: string | null;
  ended_at: string | null;
}

function toIsoTimestamp(seconds: number | null | undefined): string | null {
  if (typeof seconds !== "number" || !Number.isFinite(seconds)) return null;
  return new Date(seconds * 1000).toISOString();
}

/** Stripe expands nested objects inconsistently depending on the request, so
 *  every id read has to cope with both a bare string and an expanded object. */
export function stripeIdOf(
  value: string | { id?: string | null } | null | undefined,
): string | null {
  if (typeof value === "string") return value || null;
  if (value && typeof value === "object" && typeof value.id === "string") {
    return value.id || null;
  }
  return null;
}

export function toSubscriptionRow(
  subscription: StripeSubscriptionLike,
  userId: string,
): SubscriptionRow {
  const customerId = stripeIdOf(subscription.customer);
  if (!customerId) {
    throw new Error(`Subscription ${subscription.id} has no customer id`);
  }

  const item = subscription.items?.data?.[0];

  // The billing period moved from the subscription onto its items in Stripe API
  // version 2025-03-31.basil. Read the item first and fall back to the legacy
  // top-level fields so the handler works whichever version the account is on.
  const periodStart = item?.current_period_start ?? subscription.current_period_start;
  const periodEnd = item?.current_period_end ?? subscription.current_period_end;

  return {
    id: subscription.id,
    user_id: userId,
    stripe_customer_id: customerId,
    status: subscription.status,
    price_id: stripeIdOf(item?.price ?? null),
    product_id: stripeIdOf(item?.price?.product ?? null),
    quantity: typeof item?.quantity === "number" ? item.quantity : null,
    cancel_at_period_end: subscription.cancel_at_period_end === true,
    current_period_start: toIsoTimestamp(periodStart),
    current_period_end: toIsoTimestamp(periodEnd),
    trial_end: toIsoTimestamp(subscription.trial_end),
    canceled_at: toIsoTimestamp(subscription.canceled_at),
    ended_at: toIsoTimestamp(subscription.ended_at),
  };
}
