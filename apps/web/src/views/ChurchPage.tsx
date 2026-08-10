import { lazy, Suspense } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ChurchNotFoundError, fetchChurch, fetchChurchEvents } from "../api";
import { EVENT_TYPE_ORDER } from "../constants/eventTypes";
import { ArrowLeftIcon } from "@/components/icons";
import { InlineQueryError } from "@/components/InlineQueryError";
import { Masthead } from "@/components/Masthead";
import { ChurchPageContent } from "@/components/ChurchPageContent";
import { useDocumentMeta } from "@/hooks/useDocumentMeta";
import { useHomeHref } from "@/hooks/useHomeHref";
import {
  buildChurchDescription,
  buildChurchTitle,
  canonicalForPath,
} from "@/lib/seo";
import { ACCOUNTS_ENABLED } from "@/lib/supabaseEnv";
import { NotFoundPage } from "./NotFoundPage";

// Lazy so the Supabase client is fetched only by people who have an account to
// use it with, and never at all on builds where accounts are switched off.
const SaveChurchButton = ACCOUNTS_ENABLED
  ? lazy(() =>
      import("@/components/SaveChurchButton").then((m) => ({
        default: m.SaveChurchButton,
      })),
    )
  : null;

export function ChurchPage() {
  const { churchSlug } = useParams();
  const homeHref = useHomeHref();
  const enabled = typeof churchSlug === "string" && churchSlug.length > 0;

  const churchQuery = useQuery({
    queryKey: ["church", churchSlug],
    queryFn: () => fetchChurch(churchSlug!),
    enabled,
    retry: (_failureCount, error) =>
      !(error instanceof ChurchNotFoundError),
  });
  const eventsQuery = useQuery({
    queryKey: ["church-events", churchSlug],
    queryFn: () => fetchChurchEvents(churchSlug!, [...EVENT_TYPE_ORDER]),
    enabled,
    retry: (_failureCount, error) =>
      !(error instanceof ChurchNotFoundError),
  });

  const events = eventsQuery.data;
  const church = churchQuery.data;

  const notFound =
    !enabled ||
    churchQuery.error instanceof ChurchNotFoundError ||
    eventsQuery.error instanceof ChurchNotFoundError;

  useDocumentMeta({
    title: notFound
      ? "Parish not found · Project Carlo"
      : church
        ? buildChurchTitle(church)
        : "Parish · Project Carlo",
    description: !notFound && church ? buildChurchDescription(church) : undefined,
    canonicalUrl:
      !notFound && church && churchSlug
        ? canonicalForPath(`/churches/${encodeURIComponent(churchSlug)}/`)
        : undefined,
    noindex: notFound,
  });

  if (!enabled) {
    return (
      <NotFoundPage
        title="Parish not found"
        message="We couldn't find that parish."
      />
    );
  }

  if (
    churchQuery.error instanceof ChurchNotFoundError ||
    eventsQuery.error instanceof ChurchNotFoundError
  ) {
    return (
      <NotFoundPage
        title="Parish not found"
        message="We couldn't find that parish."
      />
    );
  }

  if (church && events) {
    return (
      <ChurchPageContent
        church={church}
        events={events}
        actions={
          ACCOUNTS_ENABLED && SaveChurchButton ? (
            <Suspense fallback={null}>
              <SaveChurchButton slug={church.slug} />
            </Suspense>
          ) : null
        }
      />
    );
  }

  return (
    <main className="min-h-svh bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule-strong bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-[calc(0.85rem+var(--safe-area-inset-top))] pb-3">
          <Link to={homeHref} className="rubric-link smallcaps text-[0.875rem]">
            <ArrowLeftIcon className="size-3" />
            Back to map
          </Link>
          <Masthead compact />
        </div>
      </header>

      <div className="mx-auto w-full max-w-5xl px-6 py-10 pb-[calc(3rem+var(--safe-area-inset-bottom))] md:py-14">
        {churchQuery.isLoading ? (
          <p className="font-serif text-sm text-ink-soft">Loading parish…</p>
        ) : null}
        {churchQuery.error ? (
          <InlineQueryError
            message={"We couldn't load this parish."}
            onRetry={() => churchQuery.refetch()}
          />
        ) : null}
        {eventsQuery.isLoading && !churchQuery.isLoading ? (
          <p className="mx-auto max-w-2xl font-serif text-sm text-ink-soft">
            Loading times…
          </p>
        ) : null}
        {eventsQuery.error ? (
          <InlineQueryError
            className="mx-auto max-w-2xl"
            message={"We couldn't load times for this parish."}
            onRetry={() => eventsQuery.refetch()}
          />
        ) : null}
      </div>
    </main>
  );
}
