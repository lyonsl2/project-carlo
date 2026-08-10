/** Plan keys, and the mapping from a plan key to a Stripe price.
 *
 *  The client sends a plan key, never a price id. Letting the browser choose
 *  the price would mean anyone could check out against a $0 price they found in
 *  another part of the account; mapping server-side keeps the set of purchasable
 *  prices to exactly the two configured here.
 */

import { requireEnv } from "./env.ts";

/** Length of the card-free trial, in days.
 *
 *  Stripe owns the clock: this is passed as trial_period_days when the first
 *  subscription is created, and after that the trial's end date lives on the
 *  subscription. Changing it here only affects trials started from now on.
 *  The same number appears in the marketing copy in apps/web/src/lib/plans.ts.
 */
export const TRIAL_PERIOD_DAYS = 7;

export const PLAN_KEYS = ["monthly", "annual"] as const;

export type PlanKey = (typeof PLAN_KEYS)[number];

const PLAN_ENV_VARS: Record<PlanKey, string> = {
  monthly: "STRIPE_PRICE_MONTHLY",
  annual: "STRIPE_PRICE_ANNUAL",
};

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function priceIdForPlan(plan: PlanKey): string {
  return requireEnv(PLAN_ENV_VARS[plan]);
}
