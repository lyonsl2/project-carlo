import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchChurch, fetchChurchEvents } from "../api";
import { EVENT_TYPE_ORDER } from "../constants/eventTypes";
import { ArrowLeftIcon } from "@/components/icons";
import { InlineQueryError } from "@/components/InlineQueryError";
import { Masthead } from "@/components/Masthead";
import { ChurchPageContent } from "@/components/ChurchPageContent";

export function ChurchPage() {
  const { churchSlug } = useParams();
  const enabled = typeof churchSlug === "string" && churchSlug.length > 0;

  const churchQuery = useQuery({
    queryKey: ["church", churchSlug],
    queryFn: () => fetchChurch(churchSlug!),
    enabled,
  });
  const eventsQuery = useQuery({
    queryKey: ["church-events", churchSlug],
    queryFn: () => fetchChurchEvents(churchSlug!, [...EVENT_TYPE_ORDER]),
    enabled,
  });

  const events = eventsQuery.data;
  const church = churchQuery.data;

  if (!enabled) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-paper px-4 py-8 text-center">
        <p className="font-serif text-base text-ink-soft">
          We couldn&apos;t find that parish.
        </p>
        <Link to="/" className="rubric-link smallcaps text-[0.875rem]">
          <ArrowLeftIcon className="size-3" />
          Back to map
        </Link>
      </main>
    );
  }

  if (church && events) {
    return <ChurchPageContent church={church} events={events} />;
  }

  return (
    <main className="min-h-svh bg-paper">
      <header className="sticky top-0 z-40 border-b border-rule-strong bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 pt-[calc(0.85rem+var(--safe-area-inset-top))] pb-3">
          <Link to="/" className="rubric-link smallcaps text-[0.875rem]">
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
