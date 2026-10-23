import { z } from "zod";
import {
  bookmarkUrl,
  confirmField,
  definedBody,
  definedQuery,
  idField,
  isoTimestamp,
  limitField,
  offsetField,
  optionalText,
  sortField,
  tagName,
  triState,
} from "./fields.js";
import type { QueryMap } from "./http.js";
import { pageLink, toPage, type PageLink } from "./page.js";
import type { Runtime } from "./runtime.js";
import { bookmarkPageSchema, bookmarkSchema, checkBookmarkSchema } from "./schemas.js";
import { withWrite, type WritePlan } from "./write-gate.js";

export const CREATE_UPSERT_WARNING =
  "Linkding silently updates an existing bookmark when the URL already exists.";

export const AUTO_TAG_WARNING =
  "Linkding merges tags from auto-tagging rules into tag_names on every update, including when tag_names is omitted.";

const listShape = {
  q: optionalText(1000, "q").describe("Search phrase. Uses the same syntax as the Linkding UI."),
  limit: limitField,
  offset: offsetField,
  modified_since: isoTimestamp
    .optional()
    .describe("Only bookmarks modified after this ISO 8601 timestamp."),
  added_since: isoTimestamp
    .optional()
    .describe("Only bookmarks added after this ISO 8601 timestamp."),
  bundle: idField.optional().describe("Bundle id. Only bookmarks matched by that bundle."),
  sort: sortField,
  shared: triState.describe("Filter shared bookmarks. off, yes, or no."),
  unread: triState.describe("Filter unread bookmarks. off, yes, or no."),
};

export const listBookmarksInput = z.object(listShape);

export const listSharedBookmarksInput = listBookmarksInput.extend({
  user: optionalText(150, "user").describe("Username whose shared bookmarks to list."),
});

export const getBookmarkInput = z.object({
  id: idField.describe("Bookmark id."),
});

export const checkBookmarkInput = z.object({
  url: bookmarkUrl.describe("URL to check."),
  ignore_cache: z
    .boolean()
    .optional()
    .describe("When true, Linkding ignores its scraped metadata cache."),
});

const bookmarkFields = {
  url: bookmarkUrl.optional().describe("Bookmark URL."),
  title: optionalText(512, "title"),
  description: optionalText(100_000, "description"),
  notes: optionalText(100_000, "notes"),
  is_archived: z.boolean().optional(),
  unread: z.boolean().optional(),
  shared: z.boolean().optional(),
  tag_names: z
    .array(tagName)
    .max(50)
    .optional()
    .describe("Tag names. Linkding creates missing tags."),
};

export const createBookmarkInput = z.object({
  url: bookmarkUrl.describe("Bookmark URL. An existing URL is updated instead of inserted."),
  title: bookmarkFields.title,
  description: bookmarkFields.description,
  notes: bookmarkFields.notes,
  is_archived: bookmarkFields.is_archived.describe("Save directly into the archive when true."),
  unread: bookmarkFields.unread,
  shared: bookmarkFields.shared,
  tag_names: bookmarkFields.tag_names,
  disable_scraping: z
    .boolean()
    .optional()
    .describe("When true, do not scrape a missing title or description."),
  disable_html_snapshot: z
    .boolean()
    .optional()
    .describe("When true, do not queue an HTML snapshot."),
  confirm: confirmField,
});

const updateError = fixedUpdateError();

function fixedUpdateError(): () => string {
  return () => "Provide at least one bookmark field. PUT (replace true) also requires url.";
}

export const updateBookmarkInput = z
  .object({
    id: idField.describe("Bookmark id."),
    ...bookmarkFields,
    replace: z
      .boolean()
      .optional()
      .describe(
        "When true, send PUT. Linkding still leaves omitted fields unchanged. url is required.",
      ),
    confirm: confirmField,
  })
  .check(
    z.refine(
      (value) => {
        const changed =
          value.url !== undefined ||
          value.title !== undefined ||
          value.description !== undefined ||
          value.notes !== undefined ||
          value.is_archived !== undefined ||
          value.unread !== undefined ||
          value.shared !== undefined ||
          value.tag_names !== undefined;
        if (!changed) return false;
        if (value.replace === true && value.url === undefined) return false;
        return true;
      },
      { error: updateError },
    ),
  );

export const bookmarkIdWriteInput = z.object({
  id: idField.describe("Bookmark id."),
  confirm: confirmField,
});

export const changesSinceInput = z.object({
  since: isoTimestamp.describe("Return bookmarks changed after this ISO 8601 timestamp."),
  field: z
    .enum(["modified_since", "added_since"])
    .optional()
    .describe("Which timestamp to filter. Defaults to modified_since."),
  scope: z
    .enum(["active", "archived", "both"])
    .optional()
    .describe("active, archived, or both. Defaults to active. Deleted bookmarks are not listed."),
  limit: limitField,
  max_pages: z
    .number()
    .int()
    .min(1)
    .max(20)
    .optional()
    .describe("Maximum pages to follow. Defaults to 5."),
});

type ListArgs = z.output<typeof listSharedBookmarksInput>;

function listQuery(args: ListArgs): QueryMap | undefined {
  return definedQuery({
    q: args.q,
    limit: args.limit,
    offset: args.offset,
    modified_since: args.modified_since,
    added_since: args.added_since,
    bundle: args.bundle,
    sort: args.sort,
    shared: args.shared,
    unread: args.unread,
    user: args.user,
  });
}

function bookmarkBody(args: {
  url?: string | undefined;
  title?: string | undefined;
  description?: string | undefined;
  notes?: string | undefined;
  is_archived?: boolean | undefined;
  unread?: boolean | undefined;
  shared?: boolean | undefined;
  tag_names?: readonly string[] | undefined;
}): Record<string, unknown> | undefined {
  return definedBody({
    url: args.url,
    title: args.title,
    description: args.description,
    notes: args.notes,
    is_archived: args.is_archived,
    unread: args.unread,
    shared: args.shared,
    tag_names: args.tag_names === undefined ? undefined : [...args.tag_names],
  });
}

async function listAt(
  runtime: Runtime,
  path: string,
  args: ListArgs,
  ttlSec: number,
): Promise<Record<string, unknown>> {
  const page = await runtime.client.getJson(
    { path, query: listQuery(args), ttlSec },
    bookmarkPageSchema,
  );
  return toPage(page, runtime.secrets);
}

export async function listBookmarks(
  runtime: Runtime,
  args: z.output<typeof listBookmarksInput>,
): Promise<Record<string, unknown>> {
  return listAt(runtime, "api/bookmarks/", args, runtime.cacheTtlSec);
}

export async function listArchivedBookmarks(
  runtime: Runtime,
  args: z.output<typeof listBookmarksInput>,
): Promise<Record<string, unknown>> {
  return listAt(runtime, "api/bookmarks/archived/", args, runtime.cacheTtlSec);
}

export async function listSharedBookmarks(
  runtime: Runtime,
  args: z.output<typeof listSharedBookmarksInput>,
): Promise<Record<string, unknown>> {
  return listAt(runtime, "api/bookmarks/shared/", args, runtime.cacheTtlSec);
}

export async function getBookmark(
  runtime: Runtime,
  args: z.output<typeof getBookmarkInput>,
): Promise<Record<string, unknown>> {
  const bookmark = await runtime.client.getJson(
    { path: `api/bookmarks/${args.id}/`, query: undefined, ttlSec: runtime.cacheTtlSec },
    bookmarkSchema,
  );
  return { bookmark };
}

export async function checkBookmarkUrl(
  runtime: Runtime,
  args: z.output<typeof checkBookmarkInput>,
): Promise<Record<string, unknown>> {
  const query = definedQuery({
    url: args.url,
    ignore_cache: args.ignore_cache === true ? "true" : undefined,
  });
  const checked = await runtime.client.getJson(
    { path: "api/bookmarks/check/", query, ttlSec: 0 },
    checkBookmarkSchema,
  );
  return {
    bookmark: checked.bookmark,
    metadata: checked.metadata,
    auto_tags: checked.auto_tags,
  };
}

export async function createBookmark(
  runtime: Runtime,
  args: z.output<typeof createBookmarkInput>,
): Promise<Record<string, unknown>> {
  const query = definedQuery({
    disable_scraping: args.disable_scraping === true ? "true" : undefined,
    disable_html_snapshot: args.disable_html_snapshot === true ? "true" : undefined,
  });
  const body = bookmarkBody(args) ?? { url: args.url };
  const plan: WritePlan = {
    method: "POST",
    path: "api/bookmarks/",
    query,
    body,
    summary: "Create a bookmark with POST /api/bookmarks/.",
    warnings: [CREATE_UPSERT_WARNING, AUTO_TAG_WARNING],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const bookmark = await runtime.client.postJson(
      { path: plan.path, query, body, ttlSec: 0, invalidate: true },
      bookmarkSchema,
    );
    return { bookmark };
  });
}

export async function updateBookmark(
  runtime: Runtime,
  args: z.output<typeof updateBookmarkInput>,
): Promise<Record<string, unknown>> {
  const method = args.replace === true ? "PUT" : "PATCH";
  const body = bookmarkBody(args) ?? {};
  const plan: WritePlan = {
    method,
    path: `api/bookmarks/${args.id}/`,
    query: undefined,
    body,
    summary: `Update bookmark ${args.id} with ${method} /api/bookmarks/${args.id}/.`,
    warnings: [AUTO_TAG_WARNING],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const request = { path: plan.path, query: undefined, body, ttlSec: 0, invalidate: true };
    const bookmark =
      method === "PUT"
        ? await runtime.client.putJson(request, bookmarkSchema)
        : await runtime.client.patchJson(request, bookmarkSchema);
    return { bookmark };
  });
}

export async function archiveBookmark(
  runtime: Runtime,
  args: z.output<typeof bookmarkIdWriteInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "POST",
    path: `api/bookmarks/${args.id}/archive/`,
    query: undefined,
    body: undefined,
    summary: `Archive bookmark ${args.id}.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const result = await runtime.client.postEmpty({ path: plan.path, query: undefined });
    return { bookmark_id: args.id, is_archived: true, status: result.status };
  });
}

export async function unarchiveBookmark(
  runtime: Runtime,
  args: z.output<typeof bookmarkIdWriteInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "POST",
    path: `api/bookmarks/${args.id}/unarchive/`,
    query: undefined,
    body: undefined,
    summary: `Unarchive bookmark ${args.id}.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const result = await runtime.client.postEmpty({ path: plan.path, query: undefined });
    return { bookmark_id: args.id, is_archived: false, status: result.status };
  });
}

export async function deleteBookmark(
  runtime: Runtime,
  args: z.output<typeof bookmarkIdWriteInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "DELETE",
    path: `api/bookmarks/${args.id}/`,
    query: undefined,
    body: undefined,
    summary: `Delete bookmark ${args.id}.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const result = await runtime.client.delete({ path: plan.path, query: undefined });
    return { bookmark_id: args.id, deleted: true, status: result.status };
  });
}

export async function changesSince(
  runtime: Runtime,
  args: z.output<typeof changesSinceInput>,
): Promise<Record<string, unknown>> {
  const field = args.field ?? "modified_since";
  const scope = args.scope ?? "active";
  const limit = args.limit ?? 100;
  const maxPages = args.max_pages ?? 5;
  const scopes: readonly ("active" | "archived")[] =
    scope === "both" ? ["active", "archived"] : scope === "archived" ? ["archived"] : ["active"];
  const bookmarks: z.output<typeof bookmarkSchema>[] = [];
  let pagesFetched = 0;
  let complete = true;
  let next: PageLink | null = null;
  let truncatedScope: "active" | "archived" | null = null;

  for (const which of scopes) {
    let offset = 0;
    const path = which === "archived" ? "api/bookmarks/archived/" : "api/bookmarks/";
    let scopeDone = false;
    while (!scopeDone && pagesFetched < maxPages) {
      const page = await runtime.client.getJson(
        {
          path,
          query: definedQuery({ [field]: args.since, limit, offset }),
          ttlSec: 0,
        },
        bookmarkPageSchema,
      );
      pagesFetched += 1;
      bookmarks.push(...page.results);
      const link = pageLink(page.next, runtime.secrets);
      if (link === null || link.offset === null || link.offset <= offset) {
        scopeDone = true;
        continue;
      }
      if (pagesFetched >= maxPages) {
        complete = false;
        truncatedScope = which;
        next = link;
        scopeDone = true;
        continue;
      }
      offset = link.offset;
    }
    if (!complete) break;
  }

  return {
    since: args.since,
    field,
    scope,
    complete,
    pages_fetched: pagesFetched,
    truncated_scope: truncatedScope,
    next,
    bookmarks,
  };
}
