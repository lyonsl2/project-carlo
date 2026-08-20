import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import {
  stripeIdOf,
  type StripeSubscriptionLike,
  toSubscriptionRow,
} from "./subscription.ts";

const USER_ID = "11111111-1111-1111-1111-111111111111";

// 2026-01-01T00:00:00Z and 2026-02-01T00:00:00Z
const PERIOD_START = 1767225600;
const PERIOD_END = 1769904000;

function baseSubscription(): StripeSubscriptionLike {
  return {
    id: "sub_123",
    status: "active",
    customer: "cus_123",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          quantity: 1,
          current_period_start: PERIOD_START,
          current_period_end: PERIOD_END,
          price: { id: "price_monthly", product: "prod_patron" },
        },
      ],
    },
  };
}

Deno.test("maps a current Stripe subscription onto a database row", () => {
  const row = toSubscriptionRow(baseSubscription(), USER_ID);

  assertEquals(row, {
    id: "sub_123",
    user_id: USER_ID,
    stripe_customer_id: "cus_123",
    status: "active",
    price_id: "price_monthly",
    product_id: "prod_patron",
    quantity: 1,
    cancel_at_period_end: false,
    current_period_start: "2026-01-01T00:00:00.000Z",
    current_period_end: "2026-02-01T00:00:00.000Z",
    trial_end: null,
    canceled_at: null,
    ended_at: null,
  });
});

Deno.test("reads the billing period from the subscription on pre-basil API versions", () => {
  const subscription = baseSubscription();
  // Older API versions put the period on the subscription, not the item.
  subscription.items = { data: [{ quantity: 1, price: { id: "price_monthly" } }] };
  subscription.current_period_start = PERIOD_START;
  subscription.current_period_end = PERIOD_END;

  const row = toSubscriptionRow(subscription, USER_ID);

  assertEquals(row.current_period_start, "2026-01-01T00:00:00.000Z");
  assertEquals(row.current_period_end, "2026-02-01T00:00:00.000Z");
});

Deno.test("prefers the item period when both are present", () => {
  const subscription = baseSubscription();
  subscription.current_period_end = PERIOD_START;

  assertEquals(
    toSubscriptionRow(subscription, USER_ID).current_period_end,
    "2026-02-01T00:00:00.000Z",
  );
});

Deno.test("handles expanded customer and product objects", () => {
  const subscription = baseSubscription();
  subscription.customer = { id: "cus_expanded" };
  subscription.items = {
    data: [{ price: { id: "price_annual", product: { id: "prod_expanded" } } }],
  };

  const row = toSubscriptionRow(subscription, USER_ID);

  assertEquals(row.stripe_customer_id, "cus_expanded");
  assertEquals(row.product_id, "prod_expanded");
  assertEquals(row.price_id, "price_annual");
});

Deno.test("carries cancellation and trial timestamps across", () => {
  const subscription = baseSubscription();
  subscription.status = "canceled";
  subscription.cancel_at_period_end = true;
  subscription.canceled_at = PERIOD_START;
  subscription.ended_at = PERIOD_END;
  subscription.trial_end = PERIOD_START;

  const row = toSubscriptionRow(subscription, USER_ID);

  assertEquals(row.status, "canceled");
  assertEquals(row.cancel_at_period_end, true);
  assertEquals(row.canceled_at, "2026-01-01T00:00:00.000Z");
  assertEquals(row.ended_at, "2026-02-01T00:00:00.000Z");
  assertEquals(row.trial_end, "2026-01-01T00:00:00.000Z");
});

Deno.test("tolerates a subscription with no items", () => {
  const subscription: StripeSubscriptionLike = {
    id: "sub_empty",
    status: "incomplete",
    customer: "cus_123",
  };

  const row = toSubscriptionRow(subscription, USER_ID);

  assertEquals(row.price_id, null);
  assertEquals(row.product_id, null);
  assertEquals(row.quantity, null);
  assertEquals(row.current_period_end, null);
  assertEquals(row.cancel_at_period_end, false);
});

Deno.test("refuses a subscription with no customer", () => {
  assertThrows(
    () => toSubscriptionRow({ id: "sub_x", status: "active", customer: null }, USER_ID),
    Error,
    "no customer id",
  );
});

Deno.test("stripeIdOf unwraps strings, objects, and blanks", () => {
  assertEquals(stripeIdOf("cus_1"), "cus_1");
  assertEquals(stripeIdOf({ id: "cus_2" }), "cus_2");
  assertEquals(stripeIdOf(null), null);
  assertEquals(stripeIdOf(undefined), null);
  assertEquals(stripeIdOf(""), null);
  assertEquals(stripeIdOf({ id: null }), null);
});
