import {
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import type FuseType from "fuse.js";
import { fetchAllChurchesForSearch, type ChurchSearchResult } from "../api";
import { formatAddress } from "../utils";
import {
  canSearchPlaces,
  PlaceSearchConfigurationError,
  searchPlaces,
  type PlaceSearchResult,
} from "../placeSearch";
import { SearchIcon, XIcon } from "@/components/icons";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover";

const DEBOUNCE_MS = 200;
type SearchMode = "place" | "parish";
type LocationStatus = "idle" | "requesting" | "error";

interface SearchTypeaheadProps {
  onChurchSelect: (church: ChurchSearchResult) => void;
  onPlaceSelect: (place: PlaceSearchResult) => void;
  filterButton: ReactNode;
  /** Hide the inline place/parish mode toggle. Defaults to false. */
  hideModeToggle?: boolean;
  /** Input/icon sizing variant. `md` (default) matches the map header; `lg` renders the hero size used on the landing page. */
  size?: "md" | "lg";
}

export function SearchTypeahead({
  onChurchSelect,
  onPlaceSelect,
  filterButton,
  hideModeToggle = false,
  size = "md",
}: SearchTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const [searchMode, setSearchMode] = useState<SearchMode>("place");
  const [locationStatus, setLocationStatus] =
    useState<LocationStatus>("idle");
  const [locationError, setLocationError] = useState<string | null>(null);
  const searchAnchorRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { data: allChurches = [], isLoading: churchesLoading } = useQuery({
    queryKey: ["church-search-index"],
    queryFn: fetchAllChurchesForSearch,
    staleTime: 5 * 60 * 1000,
  });

  const trimmedDebouncedQuery = debouncedQuery.trim();
  const shouldSearchPlaces =
    searchMode === "place" && canSearchPlaces(trimmedDebouncedQuery);
  const {
    data: placeResults = [],
    isLoading: placesLoading,
    error: placeError,
  } = useQuery({
    queryKey: ["place-search", trimmedDebouncedQuery],
    queryFn: ({ signal }) =>
      searchPlaces(trimmedDebouncedQuery, {
        signal,
      }),
    enabled: shouldSearchPlaces,
    staleTime: 10 * 60 * 1000,
    retry: false,
  });

  const FuseRef = useRef<typeof FuseType | null>(null);
  const [fuseReady, setFuseReady] = useState(false);

  useEffect(() => {
    import("fuse.js").then((m) => {
      FuseRef.current = m.default;
      setFuseReady(true);
    });
  }, []);

  const fuse = useMemo(() => {
    if (!fuseReady || !FuseRef.current) return null;
    return new FuseRef.current(
      allChurches.filter((c) => c.name),
      {
        keys: [
          { name: "name", weight: 0.62 },
          { name: "city", weight: 0.13 },
          { name: "state", weight: 0.08 },
          { name: "postal_code", weight: 0.08 },
          { name: "address_line1", weight: 0.07 },
          { name: "address_line2", weight: 0.02 },
        ],
        threshold: 0.4,
        includeScore: true,
      },
    );
  }, [fuseReady, allChurches]);

  const parishResults = useMemo(() => {
    if (searchMode !== "parish") return [];
    const trimmed = trimmedDebouncedQuery;
    if (trimmed.length < 2 || !fuse) return [];
    const matches = fuse.search(trimmed);
    return matches.slice(0, 10).map((m) => m.item);
  }, [fuse, searchMode, trimmedDebouncedQuery]);

  const isPlaceMode = searchMode === "place";
  const showCurrentLocationOption = isPlaceMode;
  const hasTypedQuery = query.trim().length > 0;
  // Place mode opens immediately so the current-location suggestion is the
  // default; parish mode still waits for enough text to search.
  const showDropdown =
    isOpen && (showCurrentLocationOption || query.trim().length >= 2);
  const showSearchStatus = !isPlaceMode || hasTypedQuery;
  const activeResults = isPlaceMode ? placeResults : parishResults;
  const hasResults = activeResults.length > 0;
  const isLoading = isPlaceMode ? placesLoading : churchesLoading;
  const heading = isPlaceMode ? "Places" : "Matching parishes";
  const placeholder = isPlaceMode
    ? "Search for a city, ZIP, or address…"
    : "Search for a parish…";
  const emptyMessage = isPlaceMode
    ? "No matching places."
    : "No matching parishes.";
  const modeButtonLabel = isPlaceMode ? "Search parishes" : "Search places";
  const placeSearchNotConfigured =
    isPlaceMode && placeError instanceof PlaceSearchConfigurationError;

  const clearQuery = useCallback(() => {
    setQuery("");
    setDebouncedQuery("");
    setIsOpen(false);
  }, []);

  const handleChurchSelect = useCallback(
    (church: ChurchSearchResult) => {
      onChurchSelect(church);
      clearQuery();
    },
    [clearQuery, onChurchSelect],
  );

  const handlePlaceSelect = useCallback(
    (place: PlaceSearchResult) => {
      onPlaceSelect(place);
      clearQuery();
    },
    [clearQuery, onPlaceSelect],
  );

  const handleCurrentLocationSelect = useCallback(() => {
    if (!navigator.geolocation) {
      setLocationStatus("error");
      setLocationError("Location is not available in this browser.");
      return;
    }

    setLocationStatus("requesting");
    setLocationError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        onPlaceSelect({
          id: `current-location-${position.coords.latitude}-${position.coords.longitude}`,
          title: "Your current location",
          subtitle: "From your browser",
          lat: position.coords.latitude,
          lng: position.coords.longitude,
          resultType: "unknown",
        });
        setLocationStatus("idle");
        clearQuery();
      },
      (error) => {
        setLocationStatus("error");
        setLocationError(
          error.code === error.PERMISSION_DENIED
            ? "Location permission was denied."
            : "Couldn't get your current location.",
        );
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      },
    );
  }, [clearQuery, onPlaceSelect]);

  const getChurchLocationText = useCallback((church: ChurchSearchResult) => {
    const address = formatAddress(church);
    if (address) return address;
    const stateZip = [church.state, church.postal_code].filter(Boolean).join(" ");
    return [church.city, stateZip].filter(Boolean).join(", ");
  }, []);

  const handleModeToggle = useCallback(
    () => {
      setSearchMode((current) => (current === "place" ? "parish" : "place"));
      setIsOpen(true);
    },
    [],
  );

  return (
    <Command
      shouldFilter={false}
      className="overflow-visible bg-transparent p-0"
    >
      <Popover open={showDropdown} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <div ref={searchAnchorRef} className="relative w-full">
            <div
              className="group flex w-full items-center gap-2 border-b pb-1.5 transition-colors"
              style={{
                borderBottomColor: isFocused
                  ? "var(--rubric)"
                  : "var(--rule-strong)",
                borderBottomWidth: isFocused ? 1.5 : 1,
              }}
            >
              <SearchIcon
                className={`shrink-0 transition-colors ${
                  size === "lg" ? "size-[22px]" : "size-4"
                } ${isFocused ? "text-rubric" : "text-ink-faint"}`}
              />
              <CommandPrimitive.Input
                value={query}
                onValueChange={(value) => {
                  setQuery(value);
                  setIsOpen(true);
                }}
                onFocus={() => {
                  setIsFocused(true);
                  setIsOpen(true);
                }}
                onBlur={() => setIsFocused(false)}
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    if (query.length > 0) {
                      clearQuery();
                    } else {
                      setIsOpen(false);
                    }
                  }
                }}
                placeholder={placeholder}
                aria-label={
                  isPlaceMode
                    ? "Search for a city, ZIP code, or address"
                    : "Search for parish by name"
                }
                autoComplete="off"
                className={`min-w-0 flex-1 bg-transparent font-serif text-ink outline-none placeholder:text-ink-faint placeholder:italic ${
                  size === "lg" ? "text-[1.375rem]" : "text-[1.0625rem]"
                }`}
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  onClick={clearQuery}
                  aria-label="Clear search"
                  className="flex size-6 shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-rubric"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
              {hideModeToggle ? null : (
                <button
                  type="button"
                  onClick={handleModeToggle}
                  className="rubric-link smallcaps ml-1 hidden whitespace-nowrap text-[0.8125rem] sm:inline-flex"
                >
                  {modeButtonLabel}
                </button>
              )}
              <div className="shrink-0">{filterButton}</div>
            </div>
            {hideModeToggle ? null : (
              <button
                type="button"
                onClick={handleModeToggle}
                className="rubric-link smallcaps mt-2 text-[0.8125rem] sm:hidden"
              >
                {modeButtonLabel}
              </button>
            )}
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          side="bottom"
          sideOffset={10}
          avoidCollisions={false}
          className="z-[950] w-[min(32rem,calc(100vw-2rem))] border-rule-strong bg-paper p-0 shadow-missal-popover"
          onOpenAutoFocus={(event) => event.preventDefault()}
          onInteractOutside={(event) => {
            const target = event.target;
            if (
              target instanceof Node &&
              searchAnchorRef.current?.contains(target)
            ) {
              event.preventDefault();
            }
          }}
        >
          <div className="border-b border-rule-strong px-4 pt-3 pb-2">
            <span className="smallcaps text-[0.8125rem] text-ink-faint">
              {heading}
            </span>
          </div>
          <CommandList className="max-h-80 px-2 py-2">
            {showCurrentLocationOption ? (
              <CommandGroup className="[&_[cmdk-group-heading]]:hidden">
                <CommandItem
                  value="Use your current location"
                  onSelect={handleCurrentLocationSelect}
                  disabled={locationStatus === "requesting"}
                  className="group relative cursor-pointer gap-0 rounded-none border-l-2 border-transparent px-3 py-2.5 font-serif text-base text-ink data-[disabled=true]:pointer-events-none data-[selected=true]:border-rubric data-[selected=true]:bg-paper-deep/60 data-[selected=true]:text-ink"
                >
                  <div className="min-w-0">
                    <div className="truncate">
                      {locationStatus === "requesting"
                        ? "Requesting your location…"
                        : "Use your current location"}
                    </div>
                    <div className="mt-0.5 truncate text-sm text-ink-faint">
                      {locationError ?? "Center the map where you are"}
                    </div>
                  </div>
                </CommandItem>
              </CommandGroup>
            ) : null}
            {showSearchStatus ? (
              isLoading ? (
                <div className="px-3 py-4 font-serif text-sm text-ink-faint">
                  {isPlaceMode ? "Searching places…" : "Loading parishes…"}
                </div>
              ) : placeSearchNotConfigured ? (
                <CommandEmpty className="px-3 py-4 text-center font-serif text-sm text-ink-faint">
                  Place search needs a Geoapify API key.
                </CommandEmpty>
              ) : isPlaceMode && placeError ? (
                <CommandEmpty className="px-3 py-4 text-center font-serif text-sm text-ink-faint">
                  Place search failed. Try again.
                </CommandEmpty>
              ) : hasResults ? (
                <CommandGroup className="[&_[cmdk-group-heading]]:hidden">
                  {isPlaceMode
                    ? placeResults.map((place) => (
                        <CommandItem
                          key={place.id}
                          value={`${place.title} ${place.subtitle ?? ""}`}
                          onSelect={() => handlePlaceSelect(place)}
                          className="group relative cursor-pointer gap-0 rounded-none border-l-2 border-transparent px-3 py-2.5 font-serif text-base text-ink data-[selected=true]:border-rubric data-[selected=true]:bg-paper-deep/60 data-[selected=true]:text-ink"
                        >
                          <div className="min-w-0">
                            <div className="truncate">{place.title}</div>
                            {place.subtitle ? (
                              <div className="mt-0.5 truncate text-sm text-ink-faint">
                                {place.subtitle}
                              </div>
                            ) : null}
                          </div>
                        </CommandItem>
                      ))
                    : parishResults.map((church) => {
                        const locationText = getChurchLocationText(church);
                        return (
                          <CommandItem
                            key={church.id}
                            value={`${church.name ?? `church-${church.id}`} ${locationText}`}
                            onSelect={() => handleChurchSelect(church)}
                            className="group relative cursor-pointer gap-0 rounded-none border-l-2 border-transparent px-3 py-2.5 font-serif text-base text-ink data-[selected=true]:border-rubric data-[selected=true]:bg-paper-deep/60 data-[selected=true]:text-ink"
                          >
                            <div className="min-w-0">
                              <div className="truncate">
                                {church.name ?? "Unnamed parish"}
                              </div>
                              {locationText ? (
                                <div className="mt-0.5 truncate text-sm text-ink-faint">
                                  {locationText}
                                </div>
                              ) : null}
                            </div>
                          </CommandItem>
                        );
                      })}
                </CommandGroup>
              ) : (
                <CommandEmpty className="px-3 py-4 text-center font-serif text-sm text-ink-faint">
                  {emptyMessage}
                </CommandEmpty>
              )
            ) : null}
          </CommandList>
          {isPlaceMode ? (
            <div className="border-t border-rule-strong px-4 py-2 text-right font-serif text-xs text-ink-faint">
              Powered by Geoapify
            </div>
          ) : null}
        </PopoverContent>
      </Popover>
    </Command>
  );
}
