import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Command as CommandPrimitive } from "cmdk";
import { useQuery } from "@tanstack/react-query";
import type FuseType from "fuse.js";
import { fetchAllChurchesForSearch, type ChurchSearchResult } from "../api";
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

interface SearchTypeaheadProps {
  onSelect: (church: ChurchSearchResult) => void;
  filterButton: React.ReactNode;
}

export function SearchTypeahead({
  onSelect,
  filterButton,
}: SearchTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [isFocused, setIsFocused] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { data: allChurches = [], isLoading } = useQuery({
    queryKey: ["church-search-index"],
    queryFn: fetchAllChurchesForSearch,
    staleTime: 5 * 60 * 1000,
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
        keys: ["name"],
        threshold: 0.4,
        includeScore: true,
      },
    );
  }, [fuseReady, allChurches]);

  const results = useMemo(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 2 || !fuse) return [];
    const matches = fuse.search(trimmed);
    return matches.slice(0, 10).map((m) => m.item);
  }, [fuse, debouncedQuery]);

  const trimmedQuery = debouncedQuery.trim();
  const showDropdown = isOpen && trimmedQuery.length >= 2;
  const hasResults = results.length > 0;

  const handleSelect = useCallback(
    (church: ChurchSearchResult) => {
      onSelect(church);
      setQuery("");
      setDebouncedQuery("");
      setIsOpen(false);
    },
    [onSelect],
  );

  return (
    <Command
      shouldFilter={false}
      className="overflow-visible bg-transparent p-0"
    >
      <Popover open={showDropdown} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <div
              className="group flex items-center gap-3 border-b pb-1.5 transition-colors"
              style={{
                borderBottomColor: isFocused
                  ? "var(--rubric)"
                  : "var(--rule-strong)",
                borderBottomWidth: isFocused ? 1.5 : 1,
              }}
            >
              <SearchIcon
                className={`size-4 shrink-0 transition-colors ${
                  isFocused ? "text-rubric" : "text-ink-faint"
                }`}
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
                      setQuery("");
                      setDebouncedQuery("");
                    } else {
                      setIsOpen(false);
                    }
                  }
                }}
                placeholder="Search for a parish…"
                aria-label="Search for parish by name"
                autoComplete="off"
                className="flex-1 bg-transparent font-serif text-[1.0625rem] text-ink outline-none placeholder:text-ink-faint placeholder:italic"
              />
              {query.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setDebouncedQuery("");
                    setIsOpen(false);
                  }}
                  aria-label="Clear search"
                  className="flex size-6 shrink-0 items-center justify-center text-ink-faint transition-colors hover:text-rubric"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
              <div className="shrink-0">{filterButton}</div>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={10}
          className="w-[min(32rem,calc(100vw-2rem))] border-rule-strong bg-paper p-0 shadow-[0_18px_40px_-18px_rgb(22_18_16/0.32),0_2px_6px_-2px_rgb(22_18_16/0.1)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b border-rule-strong px-4 pt-3 pb-2">
            <span className="smallcaps text-[0.8125rem] text-ink-faint">
              Matching parishes
            </span>
          </div>
          <CommandList className="max-h-80 px-2 py-2">
            {isLoading ? (
              <div className="px-3 py-4 font-serif text-sm text-ink-faint">
                Loading parishes…
              </div>
            ) : hasResults ? (
              <CommandGroup className="[&_[cmdk-group-heading]]:hidden">
                {results.map((church) => (
                  <CommandItem
                    key={church.id}
                    value={church.name ?? `church-${church.id}`}
                    onSelect={() => handleSelect(church)}
                    className="group relative cursor-pointer gap-0 rounded-none border-l-2 border-transparent px-3 py-2.5 font-serif text-base text-ink data-[selected=true]:border-rubric data-[selected=true]:bg-paper-deep/60 data-[selected=true]:text-ink"
                  >
                    <span className="truncate">
                      {church.name ?? "Unnamed parish"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty className="px-3 py-4 text-center font-serif text-sm text-ink-faint">
                No matching parishes.
              </CommandEmpty>
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
