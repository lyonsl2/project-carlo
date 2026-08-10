import { describe, expect, it } from "vitest";
import {
  daysRemaining,
  describeTrialRemaining,
  formatBillingDate,
  isEntitledStatus,
  pickPrimarySubscription,
  toBillingState,
  type SubscriptionSummary,
} from "./billing";

const NOW = new Date("2026-08-10T12:00:00.000Z");

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
    firstPaidAt: "2026-08-01T00:00:00.000Z",
    createdAt: "2026-08-01T00:00:00.000Z",
    ...overrides,
  };
}

describe("isEntitledStatus", () => {
  it("covers the card-free trial and a live subscription", () => {
    expect(isEntitledStatus("trialing")).toBe(true);
    expect(isEntitledStatus("active")).toBe(true);
  });

  it("keeps access through a failed renewal on a subscription that has paid", () => {
    expect(isEntitledStatus("past_due", "2026-08-01T00:00:00.000Z")).toBe(true);
  });

  it("refuses past_due when nothing has ever been paid", () => {
    // A trial that ended with a card Stripe could not charge lands here, and it
    // must not buy access.
    expect(isEntitledStatus("past_due", null)).toBe(false);
  });

  it("refuses a paused trial and everything else Stripe can report", () => {
    for (const status of [
      "paused",
      "canceled",
      "unpaid",
      "incomplete",
      "incomplete_expired",
    ]) {
      expect(isEntitledStatus(status, "2026-08-01T00:00:00.000Z")).toBe(false);
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

  it("surfaces a paused trial ahead of an older cancelled subscription", () => {
    const paused = subscription({
      id: "sub_paused",
      status: "paused",
      firstPaidAt: null,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    const cancelled = subscription({
      id: "sub_cancelled",
      status: "canceled",
      createdAt: "2026-06-01T00:00:00.000Z",
    });

    expect(pickPrimarySubscription([cancelled, paused])?.id).toBe("sub_paused");
  });

  it("falls back to the most recent when none is entitled or paused", () => {
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
  it("reports an account that has never started anything", () => {
    expect(toBillingState(null)).toEqual({ kind: "none" });
  });

  it("reports a running trial with its end date", () => {
    expect(
      toBillingState(
        subscription({
          status: "trialing",
          firstPaidAt: null,
          trialEnd: "2026-08-17T00:00:00.000Z",
        }),
      ),
    ).toEqual({ kind: "trialing", endsAt: "2026-08-17T00:00:00.000Z" });
  });

  it("reports a trial Stripe paused for want of a card", () => {
    expect(
      toBillingState(subscription({ status: "paused", firstPaidAt: null })),
    ).toEqual({ kind: "paused" });
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

  it("reports a trial cancelled before it converts as canceling, from the trial date", () => {
    expect(
      toBillingState(
        subscription({
          status: "trialing",
          cancelAtPeriodEnd: true,
          trialEnd: "2026-08-17T00:00:00.000Z",
        }),
      ),
    ).toEqual({ kind: "canceling", endsAt: "2026-08-17T00:00:00.000Z" });
  });

  it("distinguishes a failed renewal from a failed first payment", () => {
    expect(toBillingState(subscription({ status: "past_due" }))).toEqual({
      kind: "pastDue",
      retriesUntil: "2026-09-01T00:00:00.000Z",
      hasPaidBefore: true,
    });

    expect(
      toBillingState(subscription({ status: "past_due", firstPaidAt: null })),
    ).toEqual({
      kind: "pastDue",
      retriesUntil: "2026-09-01T00:00:00.000Z",
      hasPaidBefore: false,
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
});

describe("daysRemaining", () => {
  it("rounds part days up", () => {
    expect(daysRemaining("2026-08-17T12:00:00.000Z", NOW)).toBe(7);
    expect(daysRemaining("2026-08-10T18:00:00.000Z", NOW)).toBe(1);
  });

  it("floors at zero once the date has passed", () => {
    expect(daysRemaining("2026-08-09T12:00:00.000Z", NOW)).toBe(0);
  });

  it("returns null when there is no date to count to", () => {
    expect(daysRemaining(null, NOW)).toBeNull();
    expect(daysRemaining("not a date", NOW)).toBeNull();
  });
});

describe("describeTrialRemaining", () => {
  it("counts the days down in words", () => {
    expect(describeTrialRemaining("2026-08-17T12:00:00.000Z", NOW)).toBe(
      "7 days left in your free trial",
    );
    expect(describeTrialRemaining("2026-08-11T00:00:00.000Z", NOW)).toBe(
      "1 day left in your free trial",
    );
    expect(describeTrialRemaining("2026-08-09T12:00:00.000Z", NOW)).toBe(
      "Your free trial ends today",
    );
  });

  it("stays sensible with no end date", () => {
    expect(describeTrialRemaining(null, NOW)).toBe("Your free trial is running");
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
