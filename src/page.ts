import { redact } from "./redact.js";

export interface PageLink {
  path: string;
  offset: number | null;
  limit: number | null;
}

export interface Page<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

function readInt(value: string | null): number | null {
  if (value === null || !/^[0-9]+$/.test(value)) return null;
  return Number(value);
}

/** Drop the origin so a next link cannot be followed off the configured host. */
export function pageLink(raw: string | null, secrets: readonly string[]): PageLink | null {
  if (raw === null || raw.length === 0) return null;
  try {
    const url = new URL(raw, "http://linkding.local");
    return {
      path: redact(`${url.pathname}${url.search}`, secrets),
      offset: readInt(url.searchParams.get("offset")),
      limit: readInt(url.searchParams.get("limit")),
    };
  } catch {
    return { path: redact(raw, secrets), offset: null, limit: null };
  }
}

export function toPage<T>(page: Page<T>, secrets: readonly string[]): Record<string, unknown> {
  return {
    count: page.count,
    next: pageLink(page.next, secrets),
    previous: pageLink(page.previous, secrets),
    results: page.results,
  };
}
