import { assertEquals } from "jsr:@std/assert@^1";
import { decideCheckoutAction, type ExistingSubscription } from "./checkoutAction.ts";

const NOW = new Date("2026-08-10T12:00:00.000Z");

function sub(overrides: Partial<ExistingSubscription> = {}): ExistingSubscription {
  return {
    id: "sub_1",
    status: "active",
    first_paid_at: "2026-08-01T00:00:00.000Z",
    created_at: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

Deno.test("offers the full trial to a brand new account", () => {
  assertEquals(decideCheckoutAction([]), { kind: "startTrial", trialEndsAt: null });
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

// ---------------------------------------------------- the card-free trial

Deno.test("carries a running card-free trial across rather than adding to it", () => {
  // Five days left: adding a card must buy zero extra days, so Stripe is given
  // the date the trial already has.
  assertEquals(
    decideCheckoutAction([], "2026-08-15T12:00:00.000Z", NOW),
    { kind: "startTrial", trialEndsAt: "2026-08-15T12:00:00.000Z" },
  );
});

Deno.test("sells a subscription outright once the card-free trial has run out", () => {
  assertEquals(
    decideCheckoutAction([], "2026-08-09T12:00:00.000Z", NOW),
    { kind: "subscribeWithoutTrial" },
  );
});

Deno.test("bills immediately when too little of the trial is left for Stripe", () => {
  // Stripe rejects a trial_end under 48 hours out, so the last day and a half
  // of a card-free trial cannot be carried across.
  assertEquals(
    decideCheckoutAction([], "2026-08-11T12:00:00.000Z", NOW),
    { kind: "subscribeWithoutTrial" },
  );

  // Exactly 48 hours is the first value Stripe will take.
  assertEquals(
    decideCheckoutAction([], "2026-08-12T12:00:00.000Z", NOW),
    { kind: "startTrial", trialEndsAt: "2026-08-12T12:00:00.000Z" },
  );
});

Deno.test("ignores an unreadable trial date rather than granting a fresh trial", () => {
  assertEquals(
    decideCheckoutAction([], "not a date", NOW),
    { kind: "subscribeWithoutTrial" },
  );
});

Deno.test("a subscription outranks the card-free trial that preceded it", () => {
  // They took the card-free trial, subscribed, then cancelled. The trial row is
  // still there, but it has been spent.
  assertEquals(
    decideCheckoutAction(
      [sub({ status: "canceled" })],
      "2026-08-15T12:00:00.000Z",
      NOW,
    ),
    { kind: "subscribeWithoutTrial" },
  );
});
