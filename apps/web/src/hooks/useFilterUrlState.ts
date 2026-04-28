import { useCallback, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import {
  decodeFiltersFromParams,
  encodeFiltersToParams,
  type FilterState,
} from "../components/filterState";

export function useFilterUrlState(): [FilterState, (next: FilterState) => void] {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(
    () => decodeFiltersFromParams(searchParams),
    [searchParams],
  );
  const setFilters = useCallback(
    (next: FilterState) => {
      setSearchParams((prev) => encodeFiltersToParams(next, prev), {
        replace: true,
      });
    },
    [setSearchParams],
  );
  return [filters, setFilters];
}
