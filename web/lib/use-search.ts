import { useDeferredValue } from "react";
import { useStore } from "./store";
import { searchStore } from "./ui";

/** Current search query, deferred so typing stays instant while big lists re-filter. */
export function useSearchQuery() {
  const query = useDeferredValue(useStore(searchStore));
  return { query, searching: query.trim().length > 0 };
}
