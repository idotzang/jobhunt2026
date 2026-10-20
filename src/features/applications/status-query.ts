import type { Status } from "./status";

/** Returns the deduplicated statuses to filter by, or undefined when no filtering applies. */
export function normalizeStatusFilter(statuses: readonly Status[] | undefined): Status[] | undefined {
  if (!statuses || statuses.length === 0) return undefined;
  return [...new Set(statuses)];
}

export function statusChanged(current: Status, next: Status): boolean {
  return current !== next;
}
