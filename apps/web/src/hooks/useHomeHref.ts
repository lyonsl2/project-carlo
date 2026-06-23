import { useState } from "react";

/**
 * The map page keeps its full state (filters + camera) in the URL query string.
 * In-app "Back to map" links are plain pushes to "/", though, so without help
 * they'd drop that state. We stash the last map query string in sessionStorage
 * whenever it changes and replay it here, so returning to the map restores the
 * exact filters and view the user left — regardless of how they navigated away.
 */
const HOME_SEARCH_KEY = "carlo:home-search";

export function rememberHomeSearch(search: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(HOME_SEARCH_KEY, search);
  } catch {
    // Private-mode / storage-disabled: degrade to a plain "/" link.
  }
}

function readHomeSearch(): string {
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(HOME_SEARCH_KEY) ?? "";
  } catch {
    return "";
  }
}

/**
 * Returns the href for "Back to map" links: "/" plus the remembered query
 * string. Read once on mount — these links live on pages that don't outlive a
 * single visit, so there's no need to react to later storage writes.
 */
export function useHomeHref(): string {
  const [search] = useState(readHomeSearch);
  return search ? `/${search}` : "/";
}
