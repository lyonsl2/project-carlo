import { describe, expect, it } from "vitest";
import {
  canSaveMore,
  formatBillingDate,
  isEntitledStatus,
  pickPrimarySubscription,
  remainingSaves,
  toBillingState,
  type SubscriptionSummary,
} from "./billing";

function subscription(
  overrides: Partial<SubscriptionSummary> = {},
): SubscriptionSummary {
  return {
    id: "sub_1",
    status: "active",
    cancelAtPeriodEnd: false,
    currentPeriodEnd: "2026-09-01T00:00:00.000Z",
    trialEnd: null,
    endedAt: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isEntitledStatus", () => {
  it("keeps access through a failed renewal", () => {
    expect(isEntitledStatus("past_due")).toBe(true);
  });

  it("covers active and trialing", () => {
    expect(isEntitledStatus("active")).toBe(true);
    expect(isEntitledStatus("trialing")).toBe(true);
  });

  it("excludes everything else Stripe can report", () => {
    for (const status of ["canceled", "unpaid", "incomplete", "incomplete_expired", "paused"]) {
      expect(isEntitledStatus(status)).toBe(false);
    }
  });
});

describe("pickPrimarySubscription", () => {
  it("returns nothing for an account that never subscribed", () => {
    expect(pickPrimarySubscription([])).toBeNull();
  });

  it("prefers the entitled subscription over a newer dead one", () => {
    const live = subscription({ id: "sub_live", createdAt: "2026-01-01T00:00:00.000Z" });
    const dead = subscription({
      id: "sub_dead",
      status: "incomplete_expired",
      createdAt: "2026-08-01T00:00:00.000Z",
    });

    expect(pickPrimarySubscription([dead, live])?.id).toBe("sub_live");
  });

  it("falls back to the most recent when none is entitled", () => {
    const older = subscription({
      id: "sub_older",
      status: "canceled",
      createdAt: "2025-01-01T00:00:00.000Z",
    });
    const newer = subscription({
      id: "sub_newer",
      status: "canceled",
      createdAt: "2026-01-01T00:00:00.000Z",
    });

    expect(pickPrimarySubscription([older, newer])?.id).toBe("sub_newer");
  });
});

describe("toBillingState", () => {
  it("reports no subscription", () => {
    expect(toBillingState(null)).toEqual({ kind: "none" });
  });

  it("reports an active subscription with its renewal date", () => {
    expect(toBillingState(subscription())).toEqual({
      kind: "active",
      renewsAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("reports a pending cancellation rather than calling it active", () => {
    expect(toBillingState(subscription({ cancelAtPeriodEnd: true }))).toEqual({
      kind: "canceling",
      endsAt: "2026-09-01T00:00:00.000Z",
    });
  });

  it("reports a trial that is already set to cancel as canceling", () => {
    const state = toBillingState(
      subscription({ status: "trialing", cancelAtPeriodEnd: true }),
    );
    expect(state.kind).toBe("canceling");
  });

  it("reports a trial", () => {
    expect(
      toBillingState(
        subscription({ status: "trialing", trialEnd: "2026-08-15T00:00:00.000Z" }),
      ),
    ).toEqual({
      kind: "trialing",
      renewsAt: "2026-09-01T00:00:00.000Z",
      trialEndsAt: "2026-08-15T00:00:00.000Z",
    });
  });

  it("reports a failed payment", () => {
    expect(toBillingState(subscription({ status: "past_due" }))).toEqual({
      kind: "pastDue",
      retriesUntil: "2026-09-01T00:00:00.000Z",
    });
  });

  it("reports anything else as ended, keeping the raw status", () => {
    expect(
      toBillingState(
        subscription({ status: "canceled", endedAt: "2026-08-20T00:00:00.000Z" }),
      ),
    ).toEqual({
      kind: "ended",
      status: "canceled",
      endedAt: "2026-08-20T00:00:00.000Z",
    });
  });

  it("falls back to the period end when a dead subscription has no end date", () => {
    expect(toBillingState(subscription({ status: "unpaid" }))).toEqual({
      kind: "ended",
      status: "unpaid",
      endedAt: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe("saved parish allowance", () => {
  it("counts down the free tier", () => {
    expect(remainingSaves({ isPatron: false, savedCount: 1, savedLimit: 3 })).toBe(2);
    expect(canSaveMore({ isPatron: false, savedCount: 1, savedLimit: 3 })).toBe(true);
  });

  it("stops at zero once the free tier is full", () => {
    const full = { isPatron: false, savedCount: 3, savedLimit: 3 };
    expect(remainingSaves(full)).toBe(0);
    expect(canSaveMore(full)).toBe(false);
  });

  it("never goes negative if the cap is lowered under an existing account", () => {
    expect(remainingSaves({ isPatron: false, savedCount: 9, savedLimit: 3 })).toBe(0);
  });

  it("treats a null limit as unlimited", () => {
    const patron = { isPatron: true, savedCount: 40, savedLimit: null };
    expect(remainingSaves(patron)).toBeNull();
    expect(canSaveMore(patron)).toBe(true);
  });
});

describe("formatBillingDate", () => {
  it("returns null for missing or unparseable dates", () => {
    expect(formatBillingDate(null)).toBeNull();
    expect(formatBillingDate("not a date")).toBeNull();
  });

  it("formats an ISO timestamp", () => {
    expect(formatBillingDate("2026-09-01T00:00:00.000Z")).toContain("2026");
  });
});
