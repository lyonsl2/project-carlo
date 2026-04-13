import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchChurch, fetchChurchEvents } from "../api";
import { DAY_ORDER } from "../constants/days";
import { EVENT_TYPE_LABELS, EVENT_TYPE_ORDER } from "../constants/eventTypes";
import type { EventSummary, EventType } from "../types";
import {
  formatAddress,
  formatEventDate,
  formatMinutesMissal,
} from "../utils";
import {
  ArrowLeftIcon,
  ExternalLinkIcon,
  FileTextIcon,
  MapPinIcon,
} from "@/components/icons";
import { InlineQueryError } from "@/components/InlineQueryError";
import { Fleuron } from "@/components/Fleuron";
import { Masthead } from "@/components/Masthead";

interface EventsByType {
  weeklyByDay: Record<string, EventSummary[]>;
  specificDate: EventSummary[];
}

function partitionEventsByType(
  events: EventSummary[],
): Record<EventType, EventsByType> {
  const result: Record<EventType, EventsByType> = {
    mass: { weeklyByDay: {}, specificDate: [] },
    confession: { weeklyByDay: {}, specificDate: [] },
    adoration: { weeklyByDay: {}, specificDate: [] },
  };

  for (const type of EVENT_TYPE_ORDER) {
    for (const d of DAY_ORDER) {
      result[type].weeklyByDay[d] = [];
    }
  }

  for (const e of events) {
    const typeData = result[e.type];
    if (e.kind === "weekly" && e.day_of_week) {
      const day = e.day_of_week.toLowerCase();
      if (day in typeData.weeklyByDay) {
        typeData.weeklyByDay[day].push(e);
      }
    } else {
      typeData.specificDate.push(e);
    }
  }

  for (const type of EVENT_TYPE_ORDER) {
    const typeData = result[type];
    for (const day of DAY_ORDER) {
      typeData.weeklyByDay[day].sort((a, b) => a.start_time - b.start_time);
    }
    typeData.specificDate.sort((a, b) =>
      (a.date ?? "").localeCompare(b.date ?? ""),
    );
  }

  return result;
}

function formatDayLabel(day: string): string {
  const d = day.toLowerCase();
  if (d === "sunday") return "Sundays";
  if (d === "saturday") return "Saturdays";
  return d.charAt(0).toUpperCase() + d.slice(1) + "s";
}

/** Takes a day's events and returns a comma-separated run of times, e.g.
 *  `7:00 · 9:30 · 11:15 a.m.` — with the meridiem merged on shared halves. */
function formatTimeRun(events: EventSummary[]): string {
  if (events.length === 0) return "";
  return events
    .map((e) => {
      const main = formatMinutesMissal(e.start_time);
      if (e.end_time != null) {
        return `${main} – ${formatMinutesMissal(e.end_time)}`;
      }
      return main;
    })
    .join("  ·  ");
}

function PageRef({ event }: { event: EventSummary }) {
  if (event.page_number == null) return null;
  return (
    <span
      className="ml-1.5 font-serif text-[0.75rem] text-ink-faint"
      title={`Found on page ${event.page_number} of bulletin`}
    >
      (p.{event.page_number})
    </span>
  );
}

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
  const byType = useMemo(
    () => (events ? partitionEventsByType(events) : null),
    [events],
  );
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

  const church = churchQuery.data;

  return (
    <main className="min-h-svh bg-paper">
      {/* Slim header bar */}
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

        {church ? (
          <>
            <section className="rise-in mx-auto max-w-2xl text-center">
              <h2 className="font-display text-[clamp(2.25rem,6vw,3.75rem)] leading-[1.05] font-normal tracking-tight text-ink">
                {church.name ?? "Unnamed parish"}
              </h2>

              {formatAddress(church) ? (
                <p className="mt-4 flex items-center justify-center gap-2 font-serif text-[0.95rem] text-ink-soft">
                  <MapPinIcon className="size-3.5 text-brass" />
                  {formatAddress(church)}
                </p>
              ) : null}

              <Fleuron className="my-7" />

              {(church.homepage_url || church.bulletin_url) ? (
                <div className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3">
                  {church.homepage_url ? (
                    <a
                      href={church.homepage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rubric-link smallcaps inline-flex items-center gap-2 text-[0.875rem]"
                    >
                      <ExternalLinkIcon className="size-3" />
                      Visit the parish website
                    </a>
                  ) : null}
                  {church.bulletin_url ? (
                    <a
                      href={church.bulletin_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rubric-link smallcaps inline-flex items-center gap-2 text-[0.875rem]"
                    >
                      <FileTextIcon className="size-3" />
                      Latest parish bulletin (PDF)
                    </a>
                  ) : null}
                </div>
              ) : null}
            </section>

            {eventsQuery.isLoading ? (
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
            {events && events.length === 0 ? (
              <p className="mx-auto max-w-2xl text-center font-serif text-sm text-ink-soft">
                No Mass, Confession, or Adoration times are listed for this
                parish yet.
              </p>
            ) : null}

            {byType ? (
              <div className="mx-auto max-w-4xl">
                <div className="rise-in space-y-12" style={{ animationDelay: "80ms" }}>
                  {EVENT_TYPE_ORDER.map((eventType) => {
                    const { weeklyByDay, specificDate } = byType[eventType];
                    const hasWeekly = DAY_ORDER.some(
                      (d) => (weeklyByDay[d]?.length ?? 0) > 0,
                    );
                    const hasAny = hasWeekly || specificDate.length > 0;
                    if (!hasAny) return null;

                    return (
                      <section key={eventType}>
                        <div className="mb-5">
                          <h3 className="font-display text-[1.75rem] leading-none font-normal text-ink">
                            {EVENT_TYPE_LABELS[eventType]}
                          </h3>
                        </div>

                        <dl className="divide-y divide-rule">
                          {DAY_ORDER.map((day) => {
                            const dayEvents = weeklyByDay[day];
                            if (!dayEvents || dayEvents.length === 0)
                              return null;
                            return (
                              <div
                                key={day}
                                className="grid grid-cols-[6rem_1fr] items-baseline gap-4 py-2.5"
                              >
                                <dt className="smallcaps text-[0.875rem] text-ink-soft">
                                  {formatDayLabel(day)}
                                </dt>
                                <dd className="font-serif text-[1.05rem] leading-snug tabular-nums text-ink">
                                  {formatTimeRun(dayEvents)}
                                  <PageRef event={dayEvents[0]} />
                                </dd>
                              </div>
                            );
                          })}

                          {specificDate.length > 0 ? (
                            <>
                              {specificDate.map((event) => (
                                <div
                                  key={event.id}
                                  className="grid grid-cols-[6rem_1fr] items-baseline gap-4 py-2.5"
                                >
                                  <dt className="smallcaps text-[0.875rem] text-rubric">
                                    {event.date
                                      ? formatEventDate(event.date).replace(
                                          /, .+$/,
                                          "",
                                        )
                                      : "Special"}
                                  </dt>
                                  <dd className="font-serif text-[1.05rem] leading-snug text-ink">
                                    <span className="tabular-nums">
                                      {formatMinutesMissal(event.start_time)}
                                      {event.end_time != null
                                        ? ` – ${formatMinutesMissal(event.end_time)}`
                                        : ""}
                                    </span>
                                    {event.date ? (
                                      <span className="ml-2 font-serif text-[0.9rem] italic text-ink-faint">
                                        {formatEventDate(event.date)}
                                      </span>
                                    ) : null}
                                    <PageRef event={event} />
                                  </dd>
                                </div>
                              ))}
                            </>
                          ) : null}
                        </dl>
                      </section>
                    );
                  })}
                </div>
              </div>
            ) : null}

            <div className="mx-auto mt-16 max-w-2xl">
              <Fleuron solo className="text-brass" />
              <p className="mt-4 text-center font-serif text-[0.9rem] text-ink-faint">
                Mass times are extracted with AI from each parish&apos;s latest
                available bulletin and may not always be accurate. Please
                confirm details with the parish before attending.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
