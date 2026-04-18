import { Link } from "react-router-dom";
import { DAY_ORDER } from "../constants/days";
import { EVENT_TYPE_LABELS, EVENT_TYPE_ORDER } from "../constants/eventTypes";
import type { ChurchDetail, EventSummary, EventType } from "../types";
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

function formatTimeValue(event: EventSummary): string {
  const main = formatMinutesMissal(event.start_time);
  if (event.end_time != null) {
    return `${main} – ${formatMinutesMissal(event.end_time)}`;
  }
  return main;
}

function collectSectionEvents(section: EventsByType): EventSummary[] {
  const all: EventSummary[] = [];
  for (const day of DAY_ORDER) {
    const list = section.weeklyByDay[day];
    if (list) all.push(...list);
  }
  all.push(...section.specificDate);
  return all;
}

function mostCommonPageNumber(events: EventSummary[]): number | null {
  const counts = new Map<number, number>();
  let bestPage: number | null = null;
  let bestCount = 0;
  for (const e of events) {
    if (e.page_number == null) continue;
    const next = (counts.get(e.page_number) ?? 0) + 1;
    counts.set(e.page_number, next);
    if (next > bestCount) {
      bestCount = next;
      bestPage = e.page_number;
    }
  }
  return bestPage;
}

function SectionPageRef({
  pageNumber,
  bulletinUrl,
}: {
  pageNumber: number;
  bulletinUrl: string | null;
}) {
  const label = `Found on bulletin page ${pageNumber}`;
  const title = `Open bulletin at page ${pageNumber}`;
  const baseClass =
    "ml-3 font-serif text-[1rem] italic";
  if (bulletinUrl) {
    return (
      <a
        href={`${bulletinUrl}#page=${pageNumber}`}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className={`${baseClass} text-rubric underline decoration-rubric/40 decoration-from-font underline-offset-[3px] transition-colors hover:text-rubric-deep hover:decoration-rubric-deep`}
      >
        {label}
      </a>
    );
  }
  return (
    <span className={`${baseClass} text-ink-soft`} title={title}>
      {label}
    </span>
  );
}

function EventNote({ note }: { note: string | null }) {
  if (!note) return null;
  return (
    <span className="ml-2 font-serif text-[0.85rem] italic text-ink-faint">
      {note}
    </span>
  );
}

function PageRef({
  event,
  bulletinUrl,
}: {
  event: EventSummary;
  bulletinUrl: string | null;
}) {
  if (event.page_number == null) return null;
  const label = `page ${event.page_number}`;
  const title = `Open bulletin at page ${event.page_number}`;
  if (bulletinUrl) {
    return (
      <a
        href={`${bulletinUrl}#page=${event.page_number}`}
        target="_blank"
        rel="noopener noreferrer"
        title={title}
        className="ml-2.5 font-serif text-[0.9rem] italic text-rubric underline decoration-rubric/40 decoration-from-font underline-offset-[3px] transition-colors hover:text-rubric-deep hover:decoration-rubric-deep"
      >
        {label}
      </a>
    );
  }
  return (
    <span
      className="ml-2.5 font-serif text-[0.9rem] italic text-ink-soft"
      title={title}
    >
      {label}
    </span>
  );
}

interface ChurchPageContentProps {
  church: ChurchDetail;
  events: EventSummary[];
}

export function ChurchPageContent({ church, events }: ChurchPageContentProps) {
  const byType = partitionEventsByType(events);

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

        {events.length === 0 ? (
          <p className="mx-auto mt-6 max-w-2xl text-center font-serif text-sm text-ink-soft md:mt-8">
            No Mass, Confession, or Adoration times are listed for this
            parish yet.
          </p>
        ) : null}

        {events.length > 0 ? (
          <div className="mx-auto mt-6 max-w-4xl md:mt-8">
            <div className="rise-in space-y-12" style={{ animationDelay: "80ms" }}>
              {EVENT_TYPE_ORDER.map((eventType) => {
                const section = byType[eventType];
                const { weeklyByDay, specificDate } = section;
                const hasWeekly = DAY_ORDER.some(
                  (d) => (weeklyByDay[d]?.length ?? 0) > 0,
                );
                const hasAny = hasWeekly || specificDate.length > 0;
                if (!hasAny) return null;

                const sectionEvents = collectSectionEvents(section);
                const sectionPage = mostCommonPageNumber(sectionEvents);

                return (
                  <section key={eventType}>
                    <div className="mb-5 flex flex-wrap items-baseline">
                      <h3 className="font-display text-[1.75rem] leading-none font-normal text-ink">
                        {EVENT_TYPE_LABELS[eventType]}
                      </h3>
                      {sectionPage != null ? (
                        <SectionPageRef
                          pageNumber={sectionPage}
                          bulletinUrl={church.bulletin_url}
                        />
                      ) : null}
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
                            <dd className="font-serif text-[1.05rem] leading-snug text-ink">
                              {dayEvents.map((event, idx) => (
                                <span key={event.id}>
                                  {idx > 0 ? (
                                    <span className="mx-2 text-ink-faint">
                                      ·
                                    </span>
                                  ) : null}
                                  <span className="tabular-nums">
                                    {formatTimeValue(event)}
                                  </span>
                                  <EventNote note={event.note} />
                                  {event.page_number !== sectionPage ? (
                                    <PageRef
                                      event={event}
                                      bulletinUrl={church.bulletin_url}
                                    />
                                  ) : null}
                                </span>
                              ))}
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
                                <EventNote note={event.note} />
                                {event.page_number !== sectionPage ? (
                                  <PageRef
                                    event={event}
                                    bulletinUrl={church.bulletin_url}
                                  />
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
          <p className="mt-4 text-center font-serif text-[0.9rem] text-ink-faint">
            Mass times are extracted with AI from each parish&apos;s latest
            available bulletin and may not always be accurate. Please
            confirm details with the parish before attending.
          </p>
        </div>
      </div>
    </main>
  );
}
