import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchChurch, fetchChurchEvents } from "../api";
import type { EventSummary } from "../types";
import { titleCase } from "../utils";

function eventLine(event: EventSummary): string {
  if (event.kind === "weekly") {
    return `${event.day_of_week ?? "Unknown day"} at ${event.start_time}`;
  }
  return `${event.date ?? "Unknown date"} at ${event.start_time}`;
}

export function ChurchPage() {
  const { churchId } = useParams();
  const id = Number(churchId);
  const enabled = Number.isFinite(id);

  const churchQuery = useQuery({
    queryKey: ["church", id],
    queryFn: () => fetchChurch(id),
    enabled,
  });
  const eventsQuery = useQuery({
    queryKey: ["church-events", id],
    queryFn: () => fetchChurchEvents(id, ["mass", "confession", "adoration"]),
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
            <p>{churchQuery.data.address ?? "Address unavailable"}</p>
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
              {event.end_time ? <div>Ends {event.end_time}</div> : null}
              {event.next_occurrence ? <div>Next: {event.next_occurrence}</div> : null}
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
