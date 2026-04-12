import { useEffect, useState } from "react";

/** True when `window` matches `(min-width: ${minWidth}px)`. SSR-safe (false until mounted). */
export function useMinWidth(minWidth: number): boolean {
  const query = `(min-width: ${minWidth}px)`;

  const [matches, setMatches] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined") return;

    const mediaQuery = window.matchMedia(query);
    const update = () => setMatches(mediaQuery.matches);

    update();
    mediaQuery.addEventListener("change", update);
    return () => mediaQuery.removeEventListener("change", update);
  }, [query]);

  return matches;
}
