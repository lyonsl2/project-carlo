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
              className="glass-panel came-frame group flex items-center gap-3 rounded-[1.5rem] px-4 py-3 transition-all"
              style={{
                boxShadow: isFocused
                  ? "inset 0 1px 0 rgb(255 255 255 / 0.12), 0 0 0 1px color-mix(in oklch, var(--brass) 32%, transparent), 0 20px 45px -28px rgb(0 0 0 / 0.8), 0 0 24px color-mix(in oklch, var(--sapphire) 18%, transparent)"
                  : undefined,
              }}
            >
              <SearchIcon
                className={`size-4 shrink-0 transition-colors ${
                  isFocused ? "text-brass" : "text-ink-faint"
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
                className="flex-1 bg-transparent font-serif text-[1.02rem] text-paper outline-none placeholder:text-ink-faint placeholder:italic"
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
                  className="glass-chip flex size-7 shrink-0 items-center justify-center rounded-full text-ink-faint transition-colors hover:text-brass"
                >
                  <XIcon className="size-3.5" />
                </button>
              ) : null}
              <div className="shrink-0 pl-1">{filterButton}</div>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={10}
          className="glass-panel-strong w-[min(34rem,calc(100vw-2rem))] rounded-[1.5rem] border-brass/25 p-0 text-paper shadow-[0_30px_65px_-30px_rgb(0_0_0/0.82)]"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <div className="border-b border-brass/15 px-4 pt-3 pb-2">
            <span className="smallcaps text-[0.76rem] text-ink-faint">
              Matching parishes
            </span>
          </div>
          <CommandList className="max-h-80 px-2 py-2">
            {isLoading ? (
              <div className="px-3 py-4 font-serif text-sm italic text-ink-faint">
                Loading the parish registry…
              </div>
            ) : hasResults ? (
              <CommandGroup className="[&_[cmdk-group-heading]]:hidden">
                {results.map((church) => (
                  <CommandItem
                    key={church.id}
                    value={church.name ?? `church-${church.id}`}
                    onSelect={() => handleSelect(church)}
                    className="group relative cursor-pointer gap-0 rounded-xl border border-transparent px-3 py-3 font-serif text-base text-paper data-[selected=true]:border-brass/20 data-[selected=true]:bg-white/6 data-[selected=true]:text-paper"
                  >
                    <span className="truncate">
                      {church.name ?? "Unnamed parish"}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty className="px-3 py-4 text-center font-serif text-sm italic text-ink-faint">
                No parishes by that name.
              </CommandEmpty>
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
