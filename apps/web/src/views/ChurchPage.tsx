import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { fetchChurch, fetchChurchEvents } from "../api";
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
  RefreshCwIcon,
} from "@/components/icons";
import { Fleuron } from "@/components/Fleuron";
import { Masthead } from "@/components/Masthead";

const EVENT_TYPE_ORDER: EventType[] = ["mass", "confession", "adoration"];
const DAY_ORDER = [
  "sunday",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
];

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  mass: "Mass",
  confession: "Confession",
  adoration: "Adoration",
};

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
    queryFn: () =>
      fetchChurchEvents(churchSlug!, ["mass", "confession", "adoration"]),
    enabled,
  });

  const events = eventsQuery.data;
  const byType = useMemo(
    () => (events ? partitionEventsByType(events) : null),
    [events],
  );
  if (!enabled) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-nave-deep px-4 py-8 text-center text-paper">
        <p className="font-serif text-base italic text-ink-soft">
          We couldn&apos;t find that parish.
        </p>
        <Link to="/" className="rubric-link smallcaps text-[0.8rem]">
          <ArrowLeftIcon className="size-3" />
          Back to the nave
        </Link>
      </main>
    );
  }

  const church = churchQuery.data;

  return (
    <main className="min-h-svh bg-nave-deep text-paper">
      <header className="sticky top-0 z-40 border-b border-brass/12 bg-[rgb(6_10_22/0.7)] backdrop-blur-xl supports-[backdrop-filter]:bg-[rgb(6_10_22/0.55)]">
        <div className="mx-auto flex w-full max-w-6xl items-center justify-between px-6 pt-[calc(0.85rem+var(--safe-area-inset-top))] pb-3">
          <Link to="/" className="rubric-link smallcaps text-[0.8rem]">
            <ArrowLeftIcon className="size-3" />
            Back to the nave
          </Link>
          <Masthead compact />
        </div>
      </header>

      <div className="mx-auto w-full max-w-6xl px-6 py-10 pb-[calc(3rem+var(--safe-area-inset-bottom))] md:py-14">
        {churchQuery.isLoading ? (
          <p className="font-serif text-sm italic text-ink-soft">
            Lighting the chapel records…
          </p>
        ) : null}
        {churchQuery.error ? (
          <div className="flex flex-col items-start gap-3">
            <p className="font-serif text-sm italic text-ink-soft">
              We couldn&apos;t load this parish.
            </p>
            <button
              type="button"
              onClick={() => churchQuery.refetch()}
              className="rubric-link smallcaps inline-flex items-center gap-1.5 text-[0.8rem]"
            >
              <RefreshCwIcon className="size-3" />
              Try again
            </button>
          </div>
        ) : null}

        {church ? (
          <>
            <section className="glass-panel-strong came-frame rise-in mx-auto max-w-4xl rounded-[2rem] px-6 py-8 text-center md:px-10">
              <p className="smallcaps text-[0.78rem] text-ink-faint">
                Parish of
              </p>
              <h2 className="halo-title mt-3 font-display text-[clamp(2.2rem,6vw,4.2rem)] leading-[1.06] font-normal tracking-[0.03em] text-paper">
                {church.name ?? "Unnamed parish"}
              </h2>

              {formatAddress(church) ? (
                <p className="mt-5 flex items-center justify-center gap-2 font-serif text-[0.95rem] italic text-ink-soft">
                  <MapPinIcon className="size-3.5 text-brass" />
                  {formatAddress(church)}
                </p>
              ) : null}

              <Fleuron className="my-7" />

              {(church.homepage_url || church.bulletin_url) ? (
                <div className="flex flex-wrap items-center justify-center gap-3">
                  {church.homepage_url ? (
                    <a
                      href={church.homepage_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="glass-chip smallcaps inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.76rem] text-brass hover:text-glow"
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
                      className="glass-chip smallcaps inline-flex items-center gap-2 rounded-full px-4 py-2 text-[0.76rem] text-brass hover:text-glow"
                    >
                      <FileTextIcon className="size-3" />
                      Read the latest bulletin
                    </a>
                  ) : null}
                </div>
              ) : null}
            </section>

            {eventsQuery.isLoading ? (
              <p className="mx-auto mt-8 max-w-2xl font-serif text-sm italic text-ink-soft">
                Lighting the schedule panes…
              </p>
            ) : null}
            {eventsQuery.error ? (
              <div className="mx-auto mt-8 flex max-w-2xl flex-col items-start gap-3">
                <p className="font-serif text-sm italic text-ink-soft">
                  We couldn&apos;t load services for this parish.
                </p>
                <button
                  type="button"
                  onClick={() => eventsQuery.refetch()}
                  className="rubric-link smallcaps inline-flex items-center gap-1.5 text-[0.8rem]"
                >
                  <RefreshCwIcon className="size-3" />
                  Try again
                </button>
              </div>
            ) : null}
            {events && events.length === 0 ? (
              <p className="mx-auto mt-8 max-w-2xl text-center font-serif text-sm italic text-ink-soft">
                No Mass, Confession, or Adoration times are listed for this
                parish yet.
              </p>
            ) : null}

            {byType ? (
              <div className="mx-auto mt-10 max-w-5xl">
                <div className="rise-in space-y-8" style={{ animationDelay: "80ms" }}>
                  {EVENT_TYPE_ORDER.map((eventType) => {
                    const { weeklyByDay, specificDate } = byType[eventType];
                    const hasWeekly = DAY_ORDER.some(
                      (d) => (weeklyByDay[d]?.length ?? 0) > 0,
                    );
                    const hasAny = hasWeekly || specificDate.length > 0;
                    if (!hasAny) return null;

                    return (
                      <section
                        key={eventType}
                        className="glass-panel came-frame rounded-[1.8rem] px-5 py-5 md:px-7"
                      >
                        <div className="mb-5">
                          <p className="smallcaps text-[0.76rem] text-ink-faint">
                            {eventType === "mass"
                              ? "Ruby chapel"
                              : eventType === "confession"
                                ? "Sapphire chapel"
                                : "Emerald chapel"}
                          </p>
                          <h3 className="mt-2 font-display text-[1.45rem] leading-none font-normal tracking-[0.03em] text-paper">
                            {EVENT_TYPE_LABELS[eventType]}
                          </h3>
                        </div>

                        <dl className="divide-y divide-brass/12">
                          {DAY_ORDER.map((day) => {
                            const dayEvents = weeklyByDay[day];
                            if (!dayEvents || dayEvents.length === 0)
                              return null;
                            return (
                              <div
                                key={day}
                                className="grid grid-cols-[6.75rem_1fr] items-baseline gap-4 py-3"
                              >
                                <dt className="smallcaps text-[0.78rem] text-brass/90">
                                  {formatDayLabel(day)}
                                </dt>
                                <dd className="font-serif text-[1.03rem] leading-snug tabular-nums text-paper">
                                  {formatTimeRun(dayEvents)}
                                </dd>
                              </div>
                            );
                          })}

                          {specificDate.length > 0 ? (
                            <>
                              {specificDate.map((event) => (
                                <div
                                  key={event.id}
                                  className="grid grid-cols-[6.75rem_1fr] items-baseline gap-4 py-3"
                                >
                                  <dt className="smallcaps text-[0.78rem] text-brass">
                                    {event.date
                                      ? formatEventDate(event.date).replace(
                                          /, .+$/,
                                          "",
                                        )
                                      : "Special"}
                                  </dt>
                                  <dd className="font-serif text-[1.03rem] leading-snug text-paper">
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
              <p className="mt-4 text-center font-serif text-[0.9rem] italic text-ink-faint">
                Times are drawn from each parish&apos;s most recent bulletin.
                When in doubt, consult the parish directly.
              </p>
            </div>
          </>
        ) : null}
      </div>
    </main>
  );
}
