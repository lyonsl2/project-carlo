import { assertEquals, assertThrows } from "jsr:@std/assert@^1";
import { isPlanKey, priceIdForPlan } from "./plans.ts";
import { ConfigError } from "./env.ts";

Deno.test("accepts only the configured plan keys", () => {
  assertEquals(isPlanKey("monthly"), true);
  assertEquals(isPlanKey("annual"), true);
  assertEquals(isPlanKey("price_1234"), false);
  assertEquals(isPlanKey("free"), false);
  assertEquals(isPlanKey(undefined), false);
  assertEquals(isPlanKey(null), false);
  assertEquals(isPlanKey({ plan: "monthly" }), false);
});

Deno.test("maps a plan key onto the price configured for it", () => {
  Deno.env.set("STRIPE_PRICE_MONTHLY", "price_monthly_123");
  Deno.env.set("STRIPE_PRICE_ANNUAL", "price_annual_456");
  try {
    assertEquals(priceIdForPlan("monthly"), "price_monthly_123");
    assertEquals(priceIdForPlan("annual"), "price_annual_456");
  } finally {
    Deno.env.delete("STRIPE_PRICE_MONTHLY");
    Deno.env.delete("STRIPE_PRICE_ANNUAL");
  }
});

Deno.test("names the missing variable when a price is not configured", () => {
  Deno.env.delete("STRIPE_PRICE_ANNUAL");
  assertThrows(() => priceIdForPlan("annual"), ConfigError, "STRIPE_PRICE_ANNUAL");
});
