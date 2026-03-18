import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchChurches } from "../api";
import { ChurchMap } from "../components/ChurchMap";
import {
  FilterPanel,
  getTimeRange,
  type FilterState,
} from "../components/FilterPanel";
import { FilterPills } from "../components/FilterPills";

const MINUTES_PER_DAY = 24 * 60;

const DEFAULT_FILTERS: FilterState = {
  eventType: "mass",
  daysOfWeek: [],
  timeFrom: 0,
  timeTo: MINUTES_PER_DAY - 1,
};

export function HomePage() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<FilterState>(DEFAULT_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);

  const apiFilters = useMemo(() => {
    const { from, to } = getTimeRange(appliedFilters);
    return {
      types: [appliedFilters.eventType],
      daysOfWeek:
        appliedFilters.daysOfWeek.length > 0
          ? appliedFilters.daysOfWeek
          : undefined,
      timeFrom: from,
      timeTo: to,
    };
  }, [appliedFilters]);

  const { data, isLoading, error } = useQuery({
    queryKey: ["churches", apiFilters],
    queryFn: () => fetchChurches(apiFilters),
  });

  const churchesWithCoordinates = useMemo(
    () =>
      (data ?? []).filter(
        (church) => church.latitude !== null && church.longitude !== null,
      ),
    [data],
  );

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setFilterPanelOpen(false);
  }, [filters]);

  return (
    <main className="app-layout">
      <header className="search-header">
        <div className="search-bar">
          <span className="search-bar__icon" aria-hidden>
            🔍
          </span>
          <input
            type="search"
            className="search-bar__input"
            placeholder="Find a parish or event"
            aria-label="Search for parish or event"
            readOnly
          />
          <button
            type="button"
            className="search-bar__filter"
            onClick={() => setFilterPanelOpen(true)}
            aria-label="Open filters"
          >
            <span className="search-bar__filter-icon">☰</span>
            <span className="search-bar__filter-text">FILTER</span>
          </button>
        </div>
        <FilterPills filters={appliedFilters} />
      </header>

      <section className="map-section">
        <div className="map-wrap">
          {isLoading ? (
            <p className="map-loading">Loading map data...</p>
          ) : null}
          {error ? (
            <p className="map-error">Failed to load church map data.</p>
          ) : null}
          {data ? <ChurchMap churches={data} /> : null}
        </div>
      </section>

      <FilterPanel
        isOpen={filterPanelOpen}
        onClose={() => setFilterPanelOpen(false)}
        filters={filters}
        onChange={setFilters}
        onApply={handleApplyFilters}
      />
    </main>
  );
}
