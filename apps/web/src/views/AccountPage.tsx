import { useEffect, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { accountKeys } from "@/api/accountKeys";
import {
  createBillingPortalUrl,
  createCheckoutUrl,
  fetchEntitlements,
  fetchSavedChurchSlugs,
  fetchSubscriptions,
  startTrial,
  unsaveChurch,
} from "@/api/account";
import { fetchChurchesBySlugs } from "@/api";
import { useAuth } from "@/auth/AuthContext";
import { signOut } from "@/auth/authActions";
import { ArrowLeftIcon, BookmarkIcon } from "@/components/icons";
import { InlineQueryError } from "@/components/InlineQueryError";
import { Masthead } from "@/components/Masthead";
import { Button } from "@/components/ui/button";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useHomeHref } from "@/hooks/useHomeHref";
import {
  describeTrialRemaining,
  formatBillingDate,
  offersCardFreeTrial,
  pickPrimarySubscription,
  showsBillingPortal,
  toBillingState,
  type BillingState,
} from "@/lib/billing";
import { PLANS, TRIAL_PERIOD_DAYS, type PlanKey } from "@/lib/plans";
import { cn } from "@/lib/utils";

/** Stripe redirects the browser back the moment checkout succeeds, but the
 *  subscription only exists here once the webhook has been delivered. Poll for
 *  a short while rather than telling someone who has just paid that they are
 *  still on the free plan. */
const WEBHOOK_POLL_INTERVAL_MS = 2_000;
const WEBHOOK_POLL_TIMEOUT_MS = 30_000;

/** The plan a first-time visitor lands on. Monthly is the smaller ask, and the
 *  annual saving is stated on the option itself for anyone who wants it. */
const DEFAULT_PLAN: PlanKey = "monthly";

function billingHeadline(state: BillingState): string {
  switch (state.kind) {
    case "none":
      return `Start your free ${TRIAL_PERIOD_DAYS}-day trial`;
    case "cardFreeTrial":
    case "trialing":
      return describeTrialRemaining(state.endsAt);
    case "cardFreeTrialEnded":
    case "paused":
      return "Your free trial has ended";
    case "active":
      return "You're subscribed";
    case "canceling":
      return "Your subscription is ending";
    case "pastDue":
      return state.hasPaidBefore
        ? "We couldn't take your last payment"
        : "That card was declined";
    case "ended":
      return "Your subscription has ended";
  }
}

function billingDetail(state: BillingState): string | null {
  switch (state.kind) {
    case "none":
      return `Your card isn't charged for ${TRIAL_PERIOD_DAYS} days, and cancelling before then costs nothing.`;
    case "cardFreeTrial":
    case "trialing": {
      const date = formatBillingDate(state.endsAt);
      return date
        ? `Add a card before ${date} to carry on without interruption.`
        : "Add a card before it ends to carry on without interruption.";
    }
    case "cardFreeTrialEnded":
      return "Subscribe to pick up where you left off. Everything you saved is still here.";
    case "paused":
      return "Your subscription is paused. Add a payment method and it picks up where it left off.";
    case "active": {
      const date = formatBillingDate(state.renewsAt);
      return date ? `Renews on ${date}. Thank you.` : "Thank you.";
    }
    case "canceling": {
      const date = formatBillingDate(state.endsAt);
      return date
        ? `You keep access until ${date}, and won't be charged again.`
        : "You won't be charged again.";
    }
    case "pastDue": {
      const date = formatBillingDate(state.retriesUntil);
      if (!state.hasPaidBefore) {
        return "We'll try again shortly. You can also add a different card.";
      }
      return date
        ? `We'll keep trying until ${date}. Update your card to keep your access.`
        : "Update your card to keep your access.";
    }
    case "ended": {
      const date = formatBillingDate(state.endedAt);
      return date ? `It finished on ${date}.` : null;
    }
  }
}

/** The label on the button that starts a Checkout session. Every one of them
 *  now leads to a card form, so the label says so. */
function checkoutCallToAction(state: BillingState): string {
  switch (state.kind) {
    case "none":
      return `Start ${TRIAL_PERIOD_DAYS}-day free trial`;
    case "cardFreeTrial":
    case "paused":
      return "Add a payment method";
    default:
      return "Subscribe";
  }
}

export function AccountPage() {
  useDocumentMeta({ title: "Your account · Project Carlo", noindex: true });

  const { user } = useAuth();
  const homeHref = useHomeHref();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();

  const checkoutOutcome = searchParams.get("checkout");
  const [justUpgraded, setJustUpgraded] = useState(false);
  const [webhookIsLate, setWebhookIsLate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [plan, setPlan] = useState<PlanKey>(DEFAULT_PLAN);

  const entitlementsQuery = useQuery({
    queryKey: accountKeys.entitlements(),
    queryFn: fetchEntitlements,
  });
  const subscriptionsQuery = useQuery({
    queryKey: accountKeys.subscriptions(),
    queryFn: fetchSubscriptions,
  });
  const savedSlugsQuery = useQuery({
    queryKey: accountKeys.savedChurches(),
    queryFn: fetchSavedChurchSlugs,
  });

  const savedSlugs = savedSlugsQuery.data;
  const savedChurchesQuery = useQuery({
    queryKey: accountKeys.savedChurchDetails(savedSlugs),
    queryFn: () => fetchChurchesBySlugs(savedSlugs ?? []),
    enabled: savedSlugs !== undefined,
  });

  const entitlements = entitlementsQuery.data;
  const hasAccess = entitlements?.hasAccess ?? false;
  // Covers starting the trial and subscribing alike: both only take effect here
  // once Stripe's webhook has been delivered.
  const awaitingWebhook =
    checkoutOutcome === "success" && !hasAccess && !webhookIsLate;

  useEffect(() => {
    if (!awaitingWebhook) return;
    const poll = window.setInterval(() => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.entitlements() });
      void queryClient.invalidateQueries({ queryKey: accountKeys.subscriptions() });
    }, WEBHOOK_POLL_INTERVAL_MS);
    const giveUp = window.setTimeout(() => setWebhookIsLate(true), WEBHOOK_POLL_TIMEOUT_MS);
    return () => {
      window.clearInterval(poll);
      window.clearTimeout(giveUp);
    };
  }, [awaitingWebhook, queryClient]);

  useEffect(() => {
    if (checkoutOutcome !== "success" || !hasAccess) return;
    setJustUpgraded(true);
    // Drop the marker so a reload or a bookmark doesn't replay the thank-you.
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    setSearchParams(next, { replace: true });
  }, [checkoutOutcome, hasAccess, searchParams, setSearchParams]);

  const checkoutMutation = useMutation({
    mutationFn: (chosen: PlanKey) =>
      createCheckoutUrl(chosen, { successPath: "/account", cancelPath: "/account" }),
    onMutate: () => setActionError(null),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "We couldn't start checkout.",
      ),
  });

  const trialMutation = useMutation({
    mutationFn: startTrial,
    onMutate: () => setActionError(null),
    onSuccess: async () => {
      // Wait for the refetch before leaving: the route gate reads this same
      // cache entry, and a stale "no access" would bounce them straight back.
      await queryClient.invalidateQueries({ queryKey: accountKeys.all });
      void navigate(homeHref);
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "We couldn't start your trial.",
      ),
  });

  const portalMutation = useMutation({
    mutationFn: () => createBillingPortalUrl("/account"),
    onMutate: () => setActionError(null),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "We couldn't open the billing portal.",
      ),
  });

  const unsaveMutation = useMutation({
    mutationFn: (slug: string) => {
      if (!user) throw new Error("Not signed in");
      return unsaveChurch(user.id, slug);
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: accountKeys.all });
    },
  });

  const subscription = pickPrimarySubscription(subscriptionsQuery.data ?? []);
  const billingState = toBillingState(subscription, entitlements?.trialEndsAt ?? null);
  const savedChurches = savedChurchesQuery.data ?? [];
  const busy =
    checkoutMutation.isPending || portalMutation.isPending || trialMutation.isPending;
  const ready = !subscriptionsQuery.isLoading && !entitlementsQuery.isLoading;

  async function onSignOut() {
    await signOut();
    void navigate("/", { replace: true });
  }

  return (
    <main className="min-h-svh bg-paper px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-8">
        <header className="space-y-4">
          {/* Only offer the way back when there is something to go back to;
           *  without access the map would bounce straight here again. */}
          {hasAccess ? (
            <Link to={homeHref} className="rubric-link smallcaps text-[0.875rem]">
              <ArrowLeftIcon className="size-3" />
              Back to map
            </Link>
          ) : null}
          <Masthead compact />
        </header>

        <section className="space-y-2">
          <h1 className="font-display text-[2rem] leading-[1.1] text-ink sm:text-[2.5rem]">
            Your account
          </h1>
          <p className="font-serif text-base text-ink-soft">
            Signed in as {user?.email ?? "your account"}.{" "}
            <button
              type="button"
              onClick={() => void onSignOut()}
              className="rubric-link smallcaps text-[0.8rem]"
            >
              Sign out
            </button>
          </p>
        </section>

        {justUpgraded ? (
          <p className="border-l-2 border-brass pl-4 font-serif text-base text-ink-soft">
            Thank you for supporting Project Carlo.
          </p>
        ) : null}

        {awaitingWebhook ? (
          <p className="border-l-2 border-brass pl-4 font-serif text-base text-ink-soft">
            Confirming with Stripe…
          </p>
        ) : null}

        {checkoutOutcome === "success" && webhookIsLate && !hasAccess ? (
          <p className="border-l-2 border-rubric pl-4 font-serif text-base text-ink-soft">
            Stripe has your details but hasn&apos;t confirmed them here yet. This
            usually settles within a minute or two — reload the page, and get in
            touch if it doesn&apos;t.
          </p>
        ) : null}

        {checkoutOutcome === "cancelled" ? (
          <p className="border-l-2 border-rule-strong pl-4 font-serif text-base text-ink-soft">
            No payment was taken.
          </p>
        ) : null}

        <hr className="hairline" />

        <section className="space-y-4">
          <h2 className="smallcaps text-[0.875rem] text-ink">Plan</h2>

          {entitlementsQuery.error || subscriptionsQuery.error ? (
            <InlineQueryError
              message="We couldn't load your plan."
              onRetry={() => {
                void entitlementsQuery.refetch();
                void subscriptionsQuery.refetch();
              }}
            />
          ) : null}

          {entitlementsQuery.isLoading ? (
            <p className="font-serif text-sm text-ink-soft">Loading…</p>
          ) : null}

          {ready ? (
            <>
              <p className="font-serif text-base text-ink">
                {billingHeadline(billingState)}
              </p>
              {billingDetail(billingState) ? (
                <p className="font-serif text-base text-ink-soft">
                  {billingDetail(billingState)}
                </p>
              ) : null}

              {showsBillingPortal(billingState) ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => portalMutation.mutate()}
                >
                  {portalMutation.isPending ? "Opening…" : "Manage billing"}
                </Button>
              ) : (
                <div className="space-y-4">
                  <PlanChooser value={plan} onChange={setPlan} disabled={busy} />

                  <div className="flex flex-wrap items-center gap-3">
                    <Button
                      type="button"
                      disabled={busy}
                      onClick={() => checkoutMutation.mutate(plan)}
                    >
                      {checkoutMutation.isPending
                        ? "Opening Stripe…"
                        : checkoutCallToAction(billingState)}
                    </Button>

                    {/* Secondary on purpose. The trial is the same seven days
                     *  either way; taking it without a card just means we have
                     *  to ask again when it runs out. */}
                    {offersCardFreeTrial(billingState) ? (
                      <Button
                        type="button"
                        variant="ghost"
                        disabled={busy}
                        onClick={() => trialMutation.mutate()}
                      >
                        {trialMutation.isPending ? "Starting…" : "Maybe later"}
                      </Button>
                    ) : null}
                  </div>

                  {offersCardFreeTrial(billingState) ? (
                    <p className="font-serif text-[0.8rem] italic text-ink-faint">
                      <em>Maybe later</em> starts the same {TRIAL_PERIOD_DAYS} days
                      without a card. We&apos;ll ask for one when it runs out.
                    </p>
                  ) : null}
                </div>
              )}

              {hasAccess ? (
                <Link to={homeHref} className="rubric-link smallcaps text-[0.875rem]">
                  Open the map
                </Link>
              ) : null}
            </>
          ) : null}

          {actionError ? (
            <p className="font-serif text-sm text-rubric" role="alert">
              {actionError}
            </p>
          ) : null}
        </section>

        <hr className="hairline" />

        <section className="space-y-4">
          <h2 className="smallcaps text-[0.875rem] text-ink">Saved parishes</h2>

          {savedSlugsQuery.error ? (
            <InlineQueryError
              message="We couldn't load your saved parishes."
              onRetry={() => void savedSlugsQuery.refetch()}
            />
          ) : null}

          {savedChurches.length === 0 && !savedSlugsQuery.isLoading ? (
            <p className="font-serif text-base text-ink-soft">
              You haven&apos;t saved any parishes yet. Open a parish from the map
              and choose <em>Save this parish</em>.
            </p>
          ) : null}

          <ul className="divide-y divide-rule">
            {savedChurches.map((church) => (
              <li
                key={church.slug}
                className="flex items-baseline justify-between gap-4 py-2.5"
              >
                <Link
                  to={`/churches/${church.slug}`}
                  className="rubric-link font-serif text-[1.05rem]"
                >
                  {church.name ?? church.slug}
                </Link>
                <button
                  type="button"
                  onClick={() => unsaveMutation.mutate(church.slug)}
                  disabled={unsaveMutation.isPending}
                  className="rubric-link smallcaps shrink-0 text-[0.75rem] disabled:opacity-50"
                >
                  <BookmarkIcon className="size-3" filled />
                  Remove
                </button>
              </li>
            ))}
          </ul>

          {unsaveMutation.error ? (
            <p className="font-serif text-sm text-rubric" role="alert">
              That parish couldn&apos;t be removed. Please try again.
            </p>
          ) : null}
        </section>
      </div>
    </main>
  );
}

interface PlanChooserProps {
  value: PlanKey;
  onChange: (plan: PlanKey) => void;
  disabled: boolean;
}

/** Radio buttons rather than one Checkout button per plan: with a card now
 *  collected up front there is a single primary action, and the price belongs
 *  next to the choice rather than in the label of the thing you press. */
function PlanChooser({ value, onChange, disabled }: PlanChooserProps) {
  return (
    <fieldset className="flex flex-wrap gap-3" disabled={disabled}>
      <legend className="sr-only">Choose a plan</legend>
      {PLANS.map((plan) => {
        const selected = plan.key === value;
        return (
          <label
            key={plan.key}
            className={cn(
              "flex cursor-pointer items-baseline gap-2.5 border px-4 py-3 transition-colors",
              // The radio itself is visually hidden, so the ring has to be drawn
              // around the label it is standing in for.
              "has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[3px] has-[:focus-visible]:outline-rubric/75",
              selected
                ? "border-rubric bg-rubric/[0.06]"
                : "border-rule-strong hover:border-ink-faint",
              disabled && "cursor-not-allowed opacity-50",
            )}
          >
            <input
              type="radio"
              name="plan"
              value={plan.key}
              checked={selected}
              onChange={() => onChange(plan.key)}
              className="sr-only"
            />
            <span
              aria-hidden
              className={cn(
                "inline-block size-2 shrink-0 translate-y-[-1px] rounded-full transition-colors",
                selected ? "bg-rubric" : "bg-transparent ring-1 ring-rule-strong",
              )}
            />
            <span className="flex flex-col gap-0.5">
              <span
                className={cn(
                  "font-display text-[1.05rem] leading-none",
                  selected ? "text-rubric" : "text-ink",
                )}
              >
                {plan.amount} {plan.cadence}
              </span>
              {plan.note ? (
                <span className="font-serif text-[0.8rem] italic text-ink-faint">
                  {plan.note}
                </span>
              ) : null}
            </span>
          </label>
        );
      })}
    </fieldset>
  );
}
