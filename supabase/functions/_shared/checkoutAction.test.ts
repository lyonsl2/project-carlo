import { assertEquals } from "jsr:@std/assert@^1";
import { decideCheckoutAction, type ExistingSubscription } from "./checkoutAction.ts";

function sub(overrides: Partial<ExistingSubscription> = {}): ExistingSubscription {
  return {
    id: "sub_1",
    status: "active",
    first_paid_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("offers the free trial to a brand new account", () => {
  assertEquals(decideCheckoutAction([]), { kind: "startTrial" });
});

Deno.test("refuses to sell a second subscription to a live one", () => {
  for (const status of ["active", "trialing"]) {
    assertEquals(decideCheckoutAction([sub({ status })]), {
      kind: "alreadySubscribed",
    });
  }
});

Deno.test("treats a paid subscription in dunning as live", () => {
  assertEquals(
    decideCheckoutAction([
      sub({ status: "past_due", first_paid_at: "2026-08-01T00:00:00.000Z" }),
    ]),
    { kind: "alreadySubscribed" },
  );
});

Deno.test("does not treat a never-paid past_due as live", () => {
  // This is the trial that ended with a card Stripe could not charge.
  assertEquals(
    decideCheckoutAction([sub({ status: "past_due", first_paid_at: null })]),
    { kind: "subscribeWithoutTrial" },
  );
});

Deno.test("collects a card for a subscription Stripe paused at trial end", () => {
  assertEquals(
    decideCheckoutAction([
      sub({ id: "sub_paused", status: "paused", first_paid_at: null }),
    ]),
    { kind: "collectCard", subscriptionId: "sub_paused" },
  );
});

Deno.test("picks the newest paused subscription when there is more than one", () => {
  const action = decideCheckoutAction([
    sub({
      id: "sub_old",
      status: "paused",
      first_paid_at: null,
      created_at: "2025-01-01T00:00:00.000Z",
    }),
    sub({
      id: "sub_new",
      status: "paused",
      first_paid_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
    }),
  ]);

  assertEquals(action, { kind: "collectCard", subscriptionId: "sub_new" });
});

Deno.test("does not hand a second free trial to a returning customer", () => {
  assertEquals(
    decideCheckoutAction([
      sub({ status: "canceled", first_paid_at: "2026-01-01T00:00:00.000Z" }),
    ]),
    { kind: "subscribeWithoutTrial" },
  );
});

Deno.test("nor to someone whose trial simply expired", () => {
  assertEquals(
    decideCheckoutAction([
      sub({ status: "incomplete_expired", first_paid_at: null }),
    ]),
    { kind: "subscribeWithoutTrial" },
  );
});

Deno.test("prefers a live subscription over a stale paused one", () => {
  const action = decideCheckoutAction([
    sub({ id: "sub_paused", status: "paused", first_paid_at: null }),
    sub({ id: "sub_live", status: "active" }),
  ]);

  assertEquals(action, { kind: "alreadySubscribed" });
});
