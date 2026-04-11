import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { fetchChurch, fetchChurchEvents } from "../api";
import type { EventSummary, EventType } from "../types";
import {
  formatAddress,
  formatEventDate,
  formatMinutesToTime,
} from "../utils";
import {
  ArrowLeftIcon,
  ChurchIcon,
  ExternalLinkIcon,
  FileTextIcon,
  HandshakeIcon,
  MapPinIcon,
  RefreshCwIcon,
  SunIcon,
} from "@/components/icons";
import type { ComponentType, SVGProps } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
  mass: "Mass",
  adoration: "Adoration",
  confession: "Confession",
};

const EVENT_TYPE_ICONS: Record<EventType, ComponentType<SVGProps<SVGSVGElement>>> = {
  mass: ChurchIcon,
  adoration: SunIcon,
  confession: HandshakeIcon,
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
      <main className="flex min-h-svh flex-col items-center justify-center gap-4 bg-background px-4 py-8 text-center">
        <p className="text-sm text-muted-foreground">
          We couldn&apos;t find that parish.
        </p>
        <Button asChild variant="outline" size="sm">
          <Link to="/">
            <ArrowLeftIcon className="size-4" />
            Back to map
          </Link>
        </Button>
      </main>
    );
  }

  const church = churchQuery.data;
  const events = eventsQuery.data;
  const byType = events ? partitionEventsByType(events) : null;

  return (
    <main className="min-h-svh bg-background pt-[calc(3.75rem+var(--safe-area-inset-top))]">
      <header className="fixed inset-x-0 top-0 z-[1000] border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto flex w-full max-w-3xl items-center px-4 pt-[calc(0.75rem+var(--safe-area-inset-top))] pb-3 md:px-6">
          <Button asChild variant="ghost" size="sm" className="-ml-2">
            <Link to="/">
              <ArrowLeftIcon className="size-4" />
              Back to map
            </Link>
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-3xl flex-col gap-5 px-4 py-6 pb-[calc(1.5rem+var(--safe-area-inset-bottom))] md:px-6">
        {churchQuery.isLoading ? (
          <p className="my-2 text-sm text-muted-foreground">Loading parish details…</p>
        ) : null}
        {churchQuery.error ? (
          <div className="my-2 flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load this parish. Check your connection and try again.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => churchQuery.refetch()}
            >
              <RefreshCwIcon className="size-4" />
              Try again
            </Button>
          </div>
        ) : null}

        {church ? (
          <section className="space-y-4">
            <h2 className="font-heading text-3xl font-medium tracking-tight text-foreground">
              {church.name ?? "Unnamed parish"}
            </h2>
            {formatAddress(church) ? (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <MapPinIcon className="mt-0.5 size-4 shrink-0" />
                {formatAddress(church)}
              </p>
            ) : null}
            <div className="flex flex-col gap-3 sm:flex-row">
              {church.homepage_url ? (
                <Button asChild size="lg" className="sm:flex-1">
                  <a href={church.homepage_url} target="_blank" rel="noopener noreferrer">
                    <ExternalLinkIcon className="size-4" />
                    Visit website
                  </a>
                </Button>
              ) : null}
              {church.bulletin_url ? (
                <Button asChild variant="outline" size="lg" className="sm:flex-1">
                  <a href={church.bulletin_url} target="_blank" rel="noopener noreferrer">
                    <FileTextIcon className="size-4" />
                    View bulletin
                  </a>
                </Button>
              ) : null}
            </div>
          </section>
        ) : null}

        {eventsQuery.isLoading ? (
          <p className="my-2 text-sm text-muted-foreground">Loading services…</p>
        ) : null}
        {eventsQuery.error ? (
          <div className="my-2 flex flex-col items-start gap-3">
            <p className="text-sm text-muted-foreground">
              We couldn&apos;t load services for this parish.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => eventsQuery.refetch()}
            >
              <RefreshCwIcon className="size-4" />
              Try again
            </Button>
          </div>
        ) : null}
        {events && events.length === 0 ? (
          <p className="my-2 text-sm text-muted-foreground">
            No Mass, Confession, or Adoration times are listed for this parish yet.
          </p>
        ) : null}

        {byType ? (
          <div className="flex flex-col gap-4">
            {EVENT_TYPE_ORDER.map((eventType) => {
              const { weeklyByDay, specificDate } = byType[eventType];
              const hasWeekly = DAY_ORDER.some(
                (d) => (weeklyByDay[d]?.length ?? 0) > 0,
              );
              const hasAny = hasWeekly || specificDate.length > 0;
              if (!hasAny) return null;

              const EventTypeIcon = EVENT_TYPE_ICONS[eventType];
              return (
                <Card key={eventType} className="shadow-sm">
                  <CardHeader className="gap-3">
                    <div className="flex items-center gap-3">
                      <div
                        className="flex size-10 items-center justify-center rounded-full border bg-primary/10 text-primary"
                        aria-hidden
                      >
                        <EventTypeIcon className="size-5" />
                      </div>
                      <CardTitle>{EVENT_TYPE_LABELS[eventType]}</CardTitle>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {DAY_ORDER.map((day) => {
                      const dayEvents = weeklyByDay[day];
                      if (!dayEvents || dayEvents.length === 0) return null;
                      return (
                        <div key={day} className="space-y-2">
                          <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                            {formatDayLabel(day)}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {dayEvents.map((event) => (
                              <Badge
                                key={event.id}
                                variant="secondary"
                                className="rounded-full px-3 py-1 text-sm font-medium"
                              >
                                {formatEventTime(event)}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      );
                    })}

                    {specificDate.length > 0 ? (
                      <>
                        {DAY_ORDER.some((day) => (weeklyByDay[day]?.length ?? 0) > 0) ? (
                          <Separator />
                        ) : null}
                        <div className="space-y-3">
                          {specificDate.map((event) => (
                            <div key={event.id} className="space-y-1">
                              <p className="text-xs font-semibold tracking-[0.18em] text-muted-foreground uppercase">
                                {event.date ? formatEventDate(event.date) : "Specific date"}
                              </p>
                              <p className="text-base font-medium text-foreground">
                                {formatEventTime(event)}
                              </p>
                            </div>
                          ))}
                        </div>
                      </>
                    ) : null}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : null}
      </div>
    </main>
  );
}
