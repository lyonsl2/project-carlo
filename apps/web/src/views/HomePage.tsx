import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchChurches } from "../api";
import { ChurchMap } from "../components/ChurchMap";
import { EventFilters } from "../components/EventFilters";
import type { EventType } from "../types";

const DEFAULT_FILTERS: EventType[] = ["mass", "confession", "adoration"];

export function HomePage() {
  const [filters, setFilters] = useState<EventType[]>(DEFAULT_FILTERS);
  const { data, isLoading, error } = useQuery({
    queryKey: ["churches", filters],
    queryFn: () => fetchChurches(filters),
  });

  const churchesWithCoordinates = useMemo(
    () =>
      (data ?? []).filter(
        (church) => church.latitude !== null && church.longitude !== null,
      ),
    [data],
  );

  return (
    <main className="layout">
      <header className="topbar">
        <div>
          <h1>Project Carlo</h1>
          <p>Find Mass, confession, and adoration schedules by church.</p>
        </div>
      </header>

      <section className="panel">
        <h2>Filters</h2>
        <EventFilters selected={filters} onChange={setFilters} />
        <p className="caption">
          Showing {data?.length ?? 0} churches ({churchesWithCoordinates.length} mappable)
        </p>
      </section>

      <section className="map-wrap">
        {isLoading ? <p>Loading map data...</p> : null}
        {error ? <p>Failed to load church map data.</p> : null}
        {data ? <ChurchMap churches={data} /> : null}
      </section>
    </main>
  );
}
