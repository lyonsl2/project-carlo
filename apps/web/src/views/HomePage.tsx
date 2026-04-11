import { useMemo, useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchChurches, type ChurchSearchResult } from "../api";
import { ChurchMap } from "../components/ChurchMap";
import { FilterPanel } from "../components/FilterPanel";
import { FilterPills } from "../components/FilterPills";
import { SearchTypeahead } from "../components/SearchTypeahead";
import { getTimeRange, type FilterState } from "../components/filterState";
import { RefreshCwIcon, SlidersHorizontalIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";

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
  const [centerOn, setCenterOn] = useState<{
    lat: number;
    lng: number;
    churchId: number;
  } | null>(null);

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

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["churches", apiFilters],
    queryFn: () => fetchChurches(apiFilters),
  });

  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setFilterPanelOpen(false);
  }, [filters]);

  const handleChurchSelect = useCallback((church: ChurchSearchResult) => {
    if (church.latitude != null && church.longitude != null) {
      setCenterOn({
        lat: church.latitude,
        lng: church.longitude,
        churchId: church.id,
      });
      // Clear after pan so selecting the same church again re-centers
      setTimeout(() => setCenterOn(null), 1000);
    }
  }, []);

  return (
    <main className="flex min-h-svh flex-col bg-background">
      <header className="sticky top-0 z-[1000] shrink-0 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85">
        <div className="mx-auto w-full max-w-3xl px-4 pt-[calc(0.75rem+var(--safe-area-inset-top))] pb-3 md:px-6">
          <SearchTypeahead
            onSelect={handleChurchSelect}
            filterButton={
              <Button
                type="button"
                variant={filterPanelOpen ? "default" : "outline"}
                size="sm"
                className="h-10 rounded-full px-4 text-sm"
                onClick={() => setFilterPanelOpen(true)}
                aria-label="Open filters"
              >
                <SlidersHorizontalIcon className="size-4" />
                <span>Filters</span>
              </Button>
            }
          />
          <FilterPills filters={appliedFilters} />
        </div>
      </header>

      <section className="mx-auto flex min-h-0 w-full max-w-6xl flex-1 px-4 py-4 md:px-6">
        <div className="relative min-h-[72vh] w-full overflow-hidden rounded-3xl border bg-card shadow-sm">
          {isLoading ? (
            <p className="absolute inset-0 z-[1] flex items-center justify-center bg-background/70 p-4 text-sm text-muted-foreground backdrop-blur-sm">
              Loading parishes…
            </p>
          ) : null}
          {error ? (
            <div className="absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 bg-background/80 p-6 text-center backdrop-blur-sm">
              <p className="text-sm text-muted-foreground">
                We couldn&apos;t load the map. Check your connection and try again.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => refetch()}
              >
                <RefreshCwIcon className="size-4" />
                Try again
              </Button>
            </div>
          ) : null}
          {data ? (
            <ChurchMap churches={data} centerOn={centerOn} />
          ) : null}
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
