import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import Fuse from "fuse.js";
import { fetchAllChurchesForSearch, type ChurchSearchResult } from "../api";

const DEBOUNCE_MS = 200;

interface SearchTypeaheadProps {
  onSelect: (church: ChurchSearchResult) => void;
  filterButton: React.ReactNode;
}

export function SearchTypeahead({ onSelect, filterButton }: SearchTypeaheadProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQuery(query), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  const { data: allChurches = [], isLoading } = useQuery({
    queryKey: ["church-search-index"],
    queryFn: fetchAllChurchesForSearch,
    staleTime: 5 * 60 * 1000,
  });

  const fuse = useMemo(
    () =>
      new Fuse(
        allChurches.filter((c) => c.name),
        {
          keys: ["name"],
          threshold: 0.4,
          includeScore: true,
        },
      ),
    [allChurches],
  );

  const results = useMemo(() => {
    const trimmed = debouncedQuery.trim();
    if (trimmed.length < 2) return [];
    const matches = fuse.search(trimmed);
    return matches.slice(0, 10).map((m) => m.item);
  }, [fuse, debouncedQuery]);

  const showDropdown = isOpen && debouncedQuery.length >= 2;
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

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="search-typeahead" ref={containerRef}>
      <div className="search-bar">
        <span className="search-bar__icon" aria-hidden>
          🔍
        </span>
        <input
          type="search"
          className="search-bar__input"
          placeholder="Search by church name"
          aria-label="Search for church by name"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => setIsOpen(true)}
          autoComplete="off"
        />
        {filterButton}
      </div>
      {showDropdown && (
        <div className="search-typeahead__dropdown" role="listbox">
          {isLoading ? (
            <div className="search-typeahead__item search-typeahead__item--muted">
              Loading…
            </div>
          ) : hasResults ? (
            results.map((church) => (
              <button
                key={church.id}
                type="button"
                className="search-typeahead__item"
                role="option"
                onClick={() => handleSelect(church)}
              >
                {church.name ?? "Unnamed church"}
              </button>
            ))
          ) : (
            <div className="search-typeahead__item search-typeahead__item--muted">
              No churches found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
