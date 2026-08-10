/** Plan keys, and the mapping from a plan key to a Stripe price.
 *
 *  The client sends a plan key, never a price id. Letting the browser choose
 *  the price would mean anyone could check out against a $0 price they found in
 *  another part of the account; mapping server-side keeps the set of purchasable
 *  prices to exactly the two configured here.
 */

import { requireEnv } from "./env.ts";

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
