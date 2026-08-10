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
  formatBillingDate,
  pickPrimarySubscription,
  remainingSaves,
  toBillingState,
  type BillingState,
} from "@/lib/billing";
import { PLANS, type PlanKey } from "@/lib/plans";

/** Stripe redirects the browser back the moment checkout succeeds, but the
 *  subscription only exists here once the webhook has been delivered. Poll for
 *  a short while rather than telling someone who has just paid that they are
 *  still on the free plan. */
const WEBHOOK_POLL_INTERVAL_MS = 2_000;
const WEBHOOK_POLL_TIMEOUT_MS = 30_000;

function billingHeadline(state: BillingState): string {
  switch (state.kind) {
    case "none":
      return "You're on the free plan";
    case "active":
      return "You're a patron";
    case "trialing":
      return "Your trial is running";
    case "canceling":
      return "Your patronage is ending";
    case "pastDue":
      return "We couldn't take your last payment";
    case "ended":
      return "Your patronage has ended";
  }
}

function billingDetail(state: BillingState): string | null {
  switch (state.kind) {
    case "none":
      return null;
    case "active": {
      const date = formatBillingDate(state.renewsAt);
      return date ? `Renews on ${date}. Thank you.` : "Thank you.";
    }
    case "trialing": {
      const date = formatBillingDate(state.trialEndsAt ?? state.renewsAt);
      return date ? `Your first payment is due on ${date}.` : null;
    }
    case "canceling": {
      const date = formatBillingDate(state.endsAt);
      return date
        ? `You keep everything until ${date}, and won't be charged again.`
        : "You won't be charged again.";
    }
    case "pastDue": {
      const date = formatBillingDate(state.retriesUntil);
      return date
        ? `We'll keep trying until ${date}. Update your card to stay a patron.`
        : "Update your card to stay a patron.";
    }
    case "ended": {
      const date = formatBillingDate(state.endedAt);
      return date ? `It finished on ${date}.` : null;
    }
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
  const isPatron = entitlements?.isPatron ?? false;
  const awaitingWebhook = checkoutOutcome === "success" && !isPatron && !webhookIsLate;

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
    if (checkoutOutcome !== "success" || !isPatron) return;
    setJustUpgraded(true);
    // Drop the marker so a reload or a bookmark doesn't replay the thank-you.
    const next = new URLSearchParams(searchParams);
    next.delete("checkout");
    setSearchParams(next, { replace: true });
  }, [checkoutOutcome, isPatron, searchParams, setSearchParams]);

  const checkoutMutation = useMutation({
    mutationFn: (plan: PlanKey) =>
      createCheckoutUrl(plan, { successPath: "/account", cancelPath: "/account" }),
    onSuccess: (url) => {
      window.location.href = url;
    },
    onError: (error) =>
      setActionError(
        error instanceof Error ? error.message : "We couldn't start checkout.",
      ),
  });

  const portalMutation = useMutation({
    mutationFn: () => createBillingPortalUrl("/account"),
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
  const billingState = toBillingState(subscription);
  const remaining = entitlements ? remainingSaves(entitlements) : null;
  const savedChurches = savedChurchesQuery.data ?? [];
  const busy = checkoutMutation.isPending || portalMutation.isPending;

  async function onSignOut() {
    await signOut();
    void navigate("/", { replace: true });
  }

  return (
    <main className="min-h-svh bg-paper px-4 py-8 sm:py-12">
      <div className="mx-auto flex w-full max-w-[40rem] flex-col gap-8">
        <header className="space-y-4">
          <Link to={homeHref} className="rubric-link smallcaps text-[0.875rem]">
            <ArrowLeftIcon className="size-3" />
            Back to map
          </Link>
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
            Payment received — confirming with Stripe…
          </p>
        ) : null}

        {checkoutOutcome === "success" && webhookIsLate && !isPatron ? (
          <p className="border-l-2 border-rubric pl-4 font-serif text-base text-ink-soft">
            Stripe took your payment but hasn&apos;t confirmed it here yet. This
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

          {entitlements ? (
            <>
              <p className="font-serif text-base text-ink">
                {billingHeadline(billingState)}
              </p>
              {billingDetail(billingState) ? (
                <p className="font-serif text-base text-ink-soft">
                  {billingDetail(billingState)}
                </p>
              ) : null}

              {isPatron ? (
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy}
                  onClick={() => portalMutation.mutate()}
                >
                  {portalMutation.isPending ? "Opening…" : "Manage billing"}
                </Button>
              ) : (
                <>
                  <p className="font-serif text-base text-ink-soft">
                    Patrons can save any number of parishes. The map, the parish
                    pages, and the weekly bulletin parsing stay free for everyone.
                  </p>
                  <div className="flex flex-wrap gap-3">
                    {PLANS.map((plan) => (
                      <Button
                        key={plan.key}
                        type="button"
                        disabled={busy}
                        onClick={() => checkoutMutation.mutate(plan.key)}
                      >
                        {plan.amount} {plan.cadence}
                        {plan.note ? ` · ${plan.note}` : ""}
                      </Button>
                    ))}
                  </div>
                </>
              )}
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

          {entitlements && remaining !== null ? (
            <p className="font-serif text-sm text-ink-faint">
              {remaining === 0
                ? "Your free plan is full."
                : `${remaining} of ${entitlements.savedLimit} free slots left.`}
            </p>
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
        </section>
      </div>
    </main>
  );
}
