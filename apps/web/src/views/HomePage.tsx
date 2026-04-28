import {
  startTransition,
  useEffect,
  useMemo,
  useRef,
  useState,
  useCallback,
} from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { fetchChurches, type ChurchSearchResult } from "../api";
import { ChurchMap } from "../components/ChurchMap";
import { FilterPanel } from "../components/FilterPanel";
import { FilterPills } from "../components/FilterPills";
import { SearchTypeahead } from "../components/SearchTypeahead";
import { Masthead } from "../components/Masthead";
import {
  filtersEqual,
  getTimeRange,
  type FilterState,
} from "../components/filterState";
import { InlineQueryError } from "../components/InlineQueryError";
import { useMinWidth } from "../hooks/useMinWidth";
import { useFilterUrlState } from "../hooks/useFilterUrlState";

export function HomePage() {
  const [urlFilters, setUrlFilters] = useFilterUrlState();
  const [appliedFilters, setAppliedFilters] = useState<FilterState>(
    () => urlFilters,
  );
  const [filters, setFilters] = useState<FilterState>(() => urlFilters);

  // Track the last value we wrote into (or read from) the URL so we can
  // distinguish our own echoed URL updates from genuine external ones
  // (back/forward, hand-edited URL). This avoids a render whip-back when
  // our own debounced write returns through useSearchParams.
  const lastSyncedRef = useRef<FilterState>(urlFilters);

  // External URL changes → in-memory state.
  useEffect(() => {
    if (filtersEqual(urlFilters, lastSyncedRef.current)) return;
    lastSyncedRef.current = urlFilters;
    setAppliedFilters(urlFilters);
    setFilters(urlFilters);
  }, [urlFilters]);

  // In-memory changes → URL after a long quiet period. The URL is for
  // refresh/share durability, not realtime sync, so a generous debounce
  // keeps history.replaceState (and any browser-side side effects like
  // favicon refetches) from running during continuous interaction.
  useEffect(() => {
    if (filtersEqual(appliedFilters, lastSyncedRef.current)) return;
    const id = window.setTimeout(() => {
      lastSyncedRef.current = appliedFilters;
      setUrlFilters(appliedFilters);
    }, 800);
    return () => window.clearTimeout(id);
  }, [appliedFilters, setUrlFilters]);

  const [filterPanelOpen, setFilterPanelOpen] = useState(false);
  const isDesktop = useMinWidth(768);
  const [centerOn, setCenterOn] = useState<{
    lat: number;
    lng: number;
    churchId: number;
    requestId: number;
  } | null>(null);
  // Monotonic id bumped on every church selection so that re-selecting the
  // same church still produces a distinct `centerOn` value, which the map
  // uses to re-pan and re-open the popup without a timer-based reset.
  const centerRequestIdRef = useRef(0);
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
    placeholderData: keepPreviousData,
  });

  /** Mobile sheet: commit draft filters and close. Desktop: filters apply in real time. */
  const handleApplyFilters = useCallback(() => {
    setAppliedFilters(filters);
    setFilterPanelOpen(false);
  }, [filters, setAppliedFilters]);

  const handleFiltersChange = useCallback(
    (next: FilterState) => {
      // Slider thumb / button highlight stays urgent so the input feels
      // pinned to the cursor; the downstream query + map rerender is a
      // transition, which lets newer drag values pre-empt in-flight work.
      setFilters(next);
      if (isDesktop) {
        startTransition(() => setAppliedFilters(next));
      }
    },
    [isDesktop, setAppliedFilters],
  );

  const handleChurchSelect = useCallback((church: ChurchSearchResult) => {
    if (church.latitude != null && church.longitude != null) {
      centerRequestIdRef.current += 1;
      setCenterOn({
        lat: church.latitude,
        lng: church.longitude,
        churchId: church.id,
        requestId: centerRequestIdRef.current,
      });
    }
  }, []);

  return (
    <main className="relative flex min-h-svh flex-col overflow-hidden bg-paper">
      {/* Full-bleed map — no z-index so it doesn't create a stacking context;
       *  the elevated popup pane inside can then layer above the header. */}
      <div className="absolute inset-0">
        {data ? <ChurchMap churches={data} centerOn={centerOn} /> : null}
      </div>

      {/* Initial load only — filter changes keep the map mounted via placeholderData */}
      {isLoading && !data ? (
        <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center">
          <div className="pointer-events-auto flex items-center gap-3 border border-rule-strong bg-paper/95 px-5 py-3 shadow-missal-loading">
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-rubric"
              aria-hidden
            />
            <span className="font-serif text-sm text-ink-soft">
              Loading map…
            </span>
          </div>
        </div>
      ) : null}
      {error ? (
        <div className="pointer-events-none absolute inset-0 z-[800] flex items-center justify-center p-4">
          <div className="pointer-events-auto max-w-sm border border-rule-strong bg-paper/95 px-6 py-5 shadow-missal-overlay">
            <InlineQueryError
              title={"Couldn't load data"}
              message="Check your connection and try again."
              onRetry={() => refetch()}
              centered
            />
          </div>
        </div>
      ) : null}

      {/* Floating card — masthead, search, filter pills; filter panel is only as tall
       *  as its content on md+ (capped + scroll inside when needed). */}
      <div className="pointer-events-none absolute inset-x-0 top-0 bottom-0 z-[900] flex justify-center px-4 pt-[calc(1rem+var(--safe-area-inset-top))] pb-[calc(1rem+var(--safe-area-inset-bottom))] md:justify-start md:px-6 md:pt-6 md:pb-6">
        <div className="pointer-events-none flex w-full max-w-[28rem] flex-col gap-4">
          <div className="pointer-events-auto rise-in shrink-0 border border-rule-strong bg-paper/96 px-6 pt-5 pb-4 shadow-missal-floating backdrop-blur-sm">
            <Masthead />
            <div className="mt-5">
              <SearchTypeahead
                onSelect={handleChurchSelect}
                filterButton={
                  <button
                    type="button"
                    onClick={() => setFilterPanelOpen(true)}
                    aria-label="Open filters"
                    data-active={filterPanelOpen}
                    className="rubric-link smallcaps ml-1 whitespace-nowrap text-[0.875rem] md:hidden"
                  >
                    Filters
                  </button>
                }
              />
            </div>
            <FilterPills filters={appliedFilters} />
          </div>

          <div
            className={`w-full md:min-h-0 ${
              !isDesktop && !filterPanelOpen
                ? "pointer-events-none"
                : "pointer-events-auto"
            }`}
          >
            <FilterPanel
              isOpen={!isDesktop && filterPanelOpen}
              isDesktop={isDesktop}
              onClose={() => setFilterPanelOpen(false)}
              filters={filters}
              onChange={handleFiltersChange}
              onApply={handleApplyFilters}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
