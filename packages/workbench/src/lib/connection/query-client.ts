import { QueryClient } from "@tanstack/react-query";

// Shared TanStack Query cache. Tuning (staleTime, retry, invalidation on the
// `filesChanged` signal) is refined as data-fetching hooks land.
export const queryClient = new QueryClient();
