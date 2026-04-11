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
import { InputGroup, InputGroupAddon } from "@/components/ui/input-group";
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

export function SearchTypeahead({ onSelect, filterButton }: SearchTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);

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
    <Command shouldFilter={false} className="overflow-visible bg-transparent p-0">
      <Popover open={showDropdown} onOpenChange={setIsOpen}>
        <PopoverAnchor asChild>
          <div className="relative">
            <div className="flex items-center gap-2 rounded-full border bg-card/95 p-1 shadow-sm backdrop-blur-sm">
              <InputGroup className="h-10 rounded-full border-0 bg-transparent shadow-none ring-0 focus-within:ring-0">
                <InputGroupAddon className="pl-3 text-muted-foreground">
                  <SearchIcon className="size-4" />
                </InputGroupAddon>
                <CommandPrimitive.Input
                  value={query}
                  onValueChange={(value) => {
                    setQuery(value);
                    setIsOpen(true);
                  }}
                  onFocus={() => setIsOpen(true)}
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
                  placeholder="Search by parish name"
                  aria-label="Search for parish by name"
                  autoComplete="off"
                  className="flex-1 bg-transparent pr-1 text-sm outline-none placeholder:text-muted-foreground"
                />
                {query.length > 0 ? (
                  <InputGroupAddon className="pr-1">
                    <button
                      type="button"
                      onClick={() => {
                        setQuery("");
                        setDebouncedQuery("");
                        setIsOpen(false);
                      }}
                      aria-label="Clear search"
                      className="flex size-6 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    >
                      <XIcon className="size-3.5" />
                    </button>
                  </InputGroupAddon>
                ) : null}
              </InputGroup>
              <div className="shrink-0">{filterButton}</div>
            </div>
          </div>
        </PopoverAnchor>
        <PopoverContent
          align="center"
          sideOffset={8}
          className="w-[min(32rem,calc(100vw-2rem))] p-1"
          onOpenAutoFocus={(event) => event.preventDefault()}
        >
          <CommandList className="max-h-80">
            {isLoading ? (
              <div className="px-3 py-4 text-sm text-muted-foreground">
                Loading parishes…
              </div>
            ) : hasResults ? (
              <CommandGroup heading="Matching parishes">
                {results.map((church) => (
                  <CommandItem
                    key={church.id}
                    value={church.name ?? `church-${church.id}`}
                    onSelect={() => handleSelect(church)}
                    className="py-2"
                  >
                    <div className="flex flex-col">
                      <span>{church.name ?? "Unnamed parish"}</span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            ) : (
              <CommandEmpty>No parishes match that search.</CommandEmpty>
            )}
          </CommandList>
        </PopoverContent>
      </Popover>
    </Command>
  );
}
