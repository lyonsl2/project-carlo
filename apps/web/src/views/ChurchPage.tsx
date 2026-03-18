import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchChurch, fetchChurchEvents } from "../api";
import type { EventSummary } from "../types";
import { formatAddress, formatMinutesToTime, titleCase } from "../utils";

function eventLine(event: EventSummary): string {
  const timeStr = formatMinutesToTime(event.start_time);
  if (event.kind === "weekly") {
    return `${event.day_of_week ?? "Unknown day"} at ${timeStr}`;
  }
  return `${event.date ?? "Unknown date"} at ${timeStr}`;
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
      <main className="layout">
        <p>Invalid church id.</p>
      </main>
    );
  }

  return (
    <main className="layout">
      <p>
        <Link to="/">Back to map</Link>
      </p>
      {churchQuery.isLoading ? <p>Loading church details...</p> : null}
      {churchQuery.error ? <p>Unable to load church details.</p> : null}
      {churchQuery.data ? (
        <header className="topbar">
          <div>
            <h1>{churchQuery.data.name ?? "Unnamed church"}</h1>
            <p>{formatAddress(churchQuery.data) ?? "Address unavailable"}</p>
          </div>
        </header>
      ) : null}

      <section className="panel">
        <h2>Upcoming Events</h2>
        {eventsQuery.isLoading ? <p>Loading events...</p> : null}
        {eventsQuery.error ? <p>Unable to load events.</p> : null}
        {eventsQuery.data && eventsQuery.data.length === 0 ? (
          <p>No upcoming events found.</p>
        ) : null}
        <ul className="event-list">
          {eventsQuery.data?.map((event) => (
            <li key={event.id}>
              <div>
                <strong>{titleCase(event.type)}</strong>
              </div>
              <div>{eventLine(event)}</div>
              {event.end_time != null ? <div>Ends {formatMinutesToTime(event.end_time)}</div> : null}
              {event.next_occurrence ? <div>Next: {event.next_occurrence}</div> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
