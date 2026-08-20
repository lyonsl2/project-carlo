/** The plans a visitor can choose on the account page.
 *
 *  Prices are copy, not configuration: the amount actually charged is whatever
 *  the Stripe price behind STRIPE_PRICE_MONTHLY / STRIPE_PRICE_ANNUAL says. The
 *  client only ever sends a plan key, so a mismatch here shows the wrong number
 *  in the UI but cannot charge the wrong amount. Keep the two in step when you
 *  change pricing in Stripe.
 */

/** Marketing copy only. The clock that matters is Stripe's trial_period_days,
 *  set in supabase/functions/_shared/plans.ts — keep the two the same. */
export const TRIAL_PERIOD_DAYS = 7;

export const PLAN_KEYS = ["monthly", "annual"] as const;

export type PlanKey = (typeof PLAN_KEYS)[number];

export interface Plan {
  key: PlanKey;
  name: string;
  /** Formatted amount, e.g. "$3". */
  amount: string;
  /** What the amount buys, e.g. "a month". */
  cadence: string;
  note?: string;
}

export const PLANS: readonly Plan[] = [
  {
    key: "monthly",
    name: "Monthly",
    amount: "$3",
    cadence: "a month",
  },
  {
    key: "annual",
    name: "Annual",
    amount: "$30",
    cadence: "a year",
    note: "Two months free",
  },
];

export function isPlanKey(value: unknown): value is PlanKey {
  return typeof value === "string" && (PLAN_KEYS as readonly string[]).includes(value);
}

export function findPlan(key: PlanKey): Plan {
  const plan = PLANS.find((candidate) => candidate.key === key);
  if (!plan) throw new Error(`Unknown plan: ${key}`);
  return plan;
}
