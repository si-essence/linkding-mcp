import { z } from "zod";
import { confirmField } from "./confirm.js";
import { fixedError } from "./zod-messages.js";

export { confirmField };

const idError = fixedError("id must be a positive integer");
const limitError = fixedError("limit must be an integer from 1 to 1000");
const offsetError = fixedError("offset must be an integer from 0 to 1000000");
const timestampError = fixedError("timestamp must be ISO 8601, for example 2026-01-01T00:00:00Z");
const urlError = fixedError("url must be an http or https URL up to 2048 characters");

export const idField = z.number().int({ error: idError }).positive({ error: idError });

export const limitField = z
  .number()
  .int({ error: limitError })
  .min(1, { error: limitError })
  .max(1000, { error: limitError })
  .optional()
  .describe("Page size. Linkding defaults to 100.");

export const offsetField = z
  .number()
  .int({ error: offsetError })
  .min(0, { error: offsetError })
  .max(1_000_000, { error: offsetError })
  .optional()
  .describe("Number of results to skip.");

export const isoTimestamp = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/, {
    error: timestampError,
  });

export const bookmarkUrl = z
  .string()
  .trim()
  .min(1, { error: urlError })
  .max(2048, { error: urlError })
  .check(
    z.refine(
      (value) => {
        try {
          const url = new URL(value);
          return url.protocol === "http:" || url.protocol === "https:";
        } catch {
          return false;
        }
      },
      { error: urlError },
    ),
  );

export const tagName = z
  .string()
  .trim()
  .min(1, { error: fixedError("tag name must be 1 to 64 characters") })
  .max(64, { error: fixedError("tag name must be 1 to 64 characters") });

export function optionalText(max: number, label: string) {
  const error = fixedError(`${label} must be at most ${max} characters`);
  return z.string().trim().max(max, { error }).optional();
}

export const sortField = z
  .enum(["added_asc", "added_desc", "modified_asc", "modified_desc", "title_asc", "title_desc"])
  .optional()
  .describe("Sort order. Linkding defaults to added_desc.");

export const triState = z.enum(["off", "yes", "no"]).optional().describe("off, yes, or no.");

export function definedQuery(
  record: Readonly<Record<string, string | number | boolean | undefined>>,
): Readonly<Record<string, string | number | boolean>> | undefined {
  const out: Record<string, string | number | boolean> = {};
  for (const key of Object.keys(record).sort()) {
    const value = record[key];
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}

export function definedBody(
  record: Readonly<Record<string, unknown>>,
): Record<string, unknown> | undefined {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(record)) {
    if (value === undefined) continue;
    out[key] = value;
  }
  return Object.keys(out).length === 0 ? undefined : out;
}
