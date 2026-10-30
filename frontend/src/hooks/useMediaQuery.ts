import { useEffect, useState } from "react";

/** true mientras la media query coincida (se actualiza al rotar/redimensionar). */
export function useMediaQuery(query: string): boolean {
  const get = () => typeof window !== "undefined" && window.matchMedia(query).matches;
  const [matches, setMatches] = useState(get);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

/** Mismo corte que el CSS responsive (index.css: max-width 768px). */
export const useIsMobile = () => useMediaQuery("(max-width: 768px)");
