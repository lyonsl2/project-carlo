import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchChurch, fetchChurchEvents } from "../api";
import type { EventSummary, EventType } from "../types";
import { formatAddress, formatEventDate, formatMinutesToTime } from "../utils";

const EVENT_TYPE_ORDER: EventType[] = ["mass", "confession", "adoration"];
const DAY_ORDER = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const EVENT_TYPE_LABELS: Record<EventType, string> = {
  mass: "Holy Mass",
  adoration: "Adoration",
  confession: "Sacrament of Reconciliation",
};

const EVENT_TYPE_ICONS: Record<EventType, string> = {
  mass: "✞",
  adoration: "✦",
  confession: "†",
};

interface EventsByType {
  weeklyByDay: Record<string, EventSummary[]>;
  specificDate: EventSummary[];
}

function partitionEventsByType(events: EventSummary[]): Record<
  EventType,
  EventsByType
> {
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

function formatEventTime(event: EventSummary): string {
  const start = formatMinutesToTime(event.start_time);
  if (event.end_time != null) {
    return `${start} – ${formatMinutesToTime(event.end_time)}`;
  }
  return start;
}

function formatDayLabel(day: string): string {
  const d = day.toLowerCase();
  if (d === "sunday") return "SUNDAYS";
  if (d === "saturday") return "SATURDAYS";
  return d.charAt(0).toUpperCase() + d.slice(1).toUpperCase() + "S";
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
    queryFn: () => fetchChurchEvents(churchSlug!, ["mass", "confession", "adoration"]),
    enabled,
  });

  if (!enabled) {
    return (
      <main className="church-page">
        <p>Invalid church id.</p>
      </main>
    );
  }

  const church = churchQuery.data;
  const events = eventsQuery.data;
  const byType = events ? partitionEventsByType(events) : null;

  return (
    <main className="church-page">
      <header className="church-page__header">
        <Link to="/" className="church-page__back">
          <span className="church-page__back-arrow" aria-hidden>←</span>
          {" "}BACK TO MAP
        </Link>
        <h1 className="church-page__title">Project Carlo</h1>
      </header>

      <div className="church-page__hero" aria-hidden />

      <div className="church-page__content">
        {churchQuery.isLoading ? (
          <p className="church-page__loading">Loading church details...</p>
        ) : null}
        {churchQuery.error ? (
          <p className="church-page__error">Unable to load church details.</p>
        ) : null}

        {church ? (
          <section className="church-profile">
            <span className="church-profile__label">PARISH PROFILE</span>
            <h2 className="church-profile__name">
              {church.name ?? "Unnamed church"}
            </h2>
            {formatAddress(church) ? (
              <p className="church-profile__address">
                <span className="church-profile__icon" aria-hidden>📍</span>
                {formatAddress(church)}
              </p>
            ) : null}
            <div className="church-profile__actions">
              {church.homepage_url ? (
                <a
                  href={church.homepage_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="church-profile__btn"
                >
                  Visit Website
                </a>
              ) : null}
              {church.bulletin_url ? (
                <a
                  href={church.bulletin_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="church-profile__btn church-profile__btn--secondary"
                >
                  View Bulletin
                </a>
              ) : null}
            </div>
          </section>
        ) : null}

        {eventsQuery.isLoading ? (
          <p className="church-page__loading">Loading events...</p>
        ) : null}
        {eventsQuery.error ? (
          <p className="church-page__error">Unable to load events.</p>
        ) : null}
        {events && events.length === 0 ? (
          <p className="church-page__empty">No upcoming events found.</p>
        ) : null}

        {byType ? (
          <div className="schedule-cards">
            {EVENT_TYPE_ORDER.map((eventType) => {
              const { weeklyByDay, specificDate } = byType[eventType];
              const hasWeekly = DAY_ORDER.some(
                (d) => (weeklyByDay[d]?.length ?? 0) > 0,
              );
              const hasAny = hasWeekly || specificDate.length > 0;
              if (!hasAny) return null;

              return (
                <article
                  key={eventType}
                  className={`schedule-card schedule-card--${eventType}`}
                >
                  <div className="schedule-card__header">
                    <span
                      className="schedule-card__icon"
                      aria-hidden
                    >
                      {EVENT_TYPE_ICONS[eventType]}
                    </span>
                    <h3 className="schedule-card__title">
                      {EVENT_TYPE_LABELS[eventType]}
                    </h3>
                  </div>

                  {DAY_ORDER.map((day) => {
                    const dayEvents = weeklyByDay[day];
                    if (!dayEvents || dayEvents.length === 0) return null;
                    return (
                      <div key={day} className="schedule-card__day-group">
                        <span className="schedule-card__day">
                          {formatDayLabel(day)}
                        </span>
                        <div className="schedule-card__times">
                          {dayEvents.map((event, i) => (
                            <span key={event.id}>
                              {i > 0 ? (
                                <>
                                  <span className="schedule-card__sep" />
                                  {formatEventTime(event)}
                                </>
                              ) : (
                                formatEventTime(event)
                              )}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}

                  {specificDate.length > 0 ? (
                    <div className="schedule-card__specific">
                      {specificDate.map((event) => (
                        <div key={event.id} className="schedule-card__day-group">
                          <span className="schedule-card__day">
                            {event.date ? formatEventDate(event.date) : "Specific date"}
                          </span>
                          <div className="schedule-card__times">
                            {formatEventTime(event)}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </main>
  );
}
