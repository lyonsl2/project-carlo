import { useMemo, useState, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchChurches, type ChurchSearchResult } from "../api";
import { ChurchMap } from "../components/ChurchMap";
import { FilterPanel } from "../components/FilterPanel";
import { FilterPills } from "../components/FilterPills";
import { SearchTypeahead } from "../components/SearchTypeahead";
import { Masthead } from "../components/Masthead";
import { getTimeRange, type FilterState } from "../components/filterState";
import { RefreshCwIcon, CandleIcon } from "@/components/icons";

const MINUTES_PER_DAY = 24 * 60;

const DEFAULT_FILTERS: FilterState = {
  eventType: "mass",
  daysOfWeek: [],
  timeFrom: 0,
  timeTo: MINUTES_PER_DAY - 1,
};

function useIsDesktop() {
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia("(min-width: 768px)");
    const update = () => setIsDesktop(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, []);

  return isDesktop;
}

export function HomePage() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [appliedFilters, setAppliedFilters] =
    useState<FilterState>(DEFAULT_FILTERS);
  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const isDesktop = useIsDesktop();
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
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-nave-deep text-paper">
      <div className="absolute inset-0 z-0">
        {data ? <ChurchMap churches={data} centerOn={centerOn} /> : null}
      </div>

      {isLoading ? (
        <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center">
          <div className="glass-panel-strong pointer-events-auto flex items-center gap-3 rounded-full px-5 py-3">
            <CandleIcon className="size-4 animate-pulse text-brass" />
            <span className="font-serif text-sm italic text-ink-soft">
              Lighting the transept…
            </span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center p-4">
          <div className="glass-panel-strong pointer-events-auto max-w-sm rounded-[1.75rem] px-6 py-5 text-center">
            <p className="smallcaps mb-2 text-[0.78rem] text-brass">
              The nave has gone dim
            </p>
            <p className="font-serif text-sm italic text-ink-soft">
              The parish registry could not be reached. Check the connection and
              open the window again.
            </p>
            <button
              type="button"
              onClick={() => refetch()}
              className="rubric-link smallcaps mt-4 inline-flex items-center gap-1.5 text-[0.8rem]"
            >
              <RefreshCwIcon className="size-3" />
              Try again
            </button>
          </div>
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-[900] flex justify-center px-4 pt-[calc(1rem+var(--safe-area-inset-top))] md:justify-start md:px-6 md:pt-6">
        <div className="pointer-events-auto w-full max-w-[32.5rem] space-y-4">
          <div className="glass-panel-strong came-frame rise-in rounded-[2rem] px-6 pt-5 pb-5 shadow-[0_40px_90px_-42px_rgb(0_0_0/0.82)]">
            <Masthead />
            <div className="mt-6">
              <SearchTypeahead
                onSelect={handleChurchSelect}
                filterButton={
                  <button
                    type="button"
                    onClick={() => setFilterPanelOpen(true)}
                    aria-label="Open filters"
                    data-active={filterPanelOpen}
                    className="glass-chip smallcaps ml-1 rounded-full px-3 py-1.5 text-[0.76rem] text-brass md:hidden"
                  >
                    Filters
                  </button>
                }
              />
            </div>
            <FilterPills filters={appliedFilters} />
          </div>

          <FilterPanel
            isOpen={!isDesktop && filterPanelOpen}
            onClose={() => setFilterPanelOpen(false)}
            filters={filters}
            onChange={setFilters}
            onApply={handleApplyFilters}
          />
        </div>
      </div>

      <div className="pointer-events-none absolute right-4 bottom-4 z-[900]">
        <p className="glass-chip rounded-full px-3 py-1.5 font-serif text-[0.78rem] italic text-ink-faint/90">
          Cartography from{" "}
          <span className="smallcaps not-italic text-brass/85">
            OpenStreetMap
          </span>
        </p>
      </div>
    </main>
  );
}
