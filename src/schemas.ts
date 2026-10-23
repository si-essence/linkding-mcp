import { z } from "zod";

export const bookmarkSchema = z
  .object({
    id: z.number().int(),
    url: z.string(),
    title: z.string(),
    description: z.string(),
    notes: z.string(),
    web_archive_snapshot_url: z.string().nullable(),
    favicon_url: z.string().nullable(),
    preview_image_url: z.string().nullable(),
    is_archived: z.boolean(),
    unread: z.boolean(),
    shared: z.boolean(),
    tag_names: z.array(z.string()),
    date_added: z.string(),
    date_modified: z.string(),
    website_title: z.string().nullable().optional(),
    website_description: z.string().nullable().optional(),
  })
  .loose();

export const tagSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    date_added: z.string(),
  })
  .loose();

export const bundleSchema = z
  .object({
    id: z.number().int(),
    name: z.string(),
    search: z.string(),
    any_tags: z.string(),
    all_tags: z.string(),
    excluded_tags: z.string(),
    filter_unread: z.string(),
    filter_shared: z.string(),
    order: z.number().int(),
    date_created: z.string(),
    date_modified: z.string(),
  })
  .loose();

export const assetSchema = z
  .object({
    id: z.number().int(),
    bookmark: z.number().int(),
    date_created: z.string(),
    file_size: z.number().int().nullable().optional(),
    asset_type: z.string(),
    content_type: z.string(),
    display_name: z.string(),
    status: z.string(),
  })
  .loose();

export const userProfileSchema = z
  .object({
    theme: z.string(),
    bookmark_date_display: z.string(),
    bookmark_link_target: z.string(),
    web_archive_integration: z.string(),
    tag_search: z.string(),
    enable_sharing: z.boolean(),
    enable_public_sharing: z.boolean(),
    enable_favicons: z.boolean(),
    display_url: z.boolean(),
    permanent_notes: z.boolean(),
    search_preferences: z.record(z.string(), z.unknown()),
    version: z.string().optional(),
  })
  .loose();

export const checkBookmarkSchema = z
  .object({
    bookmark: bookmarkSchema.nullable(),
    metadata: z.record(z.string(), z.unknown()),
    auto_tags: z.array(z.string()),
  })
  .loose();

export const emptyResultSchema = z.object({
  status: z.number().int(),
});

export function pageSchema<T extends z.ZodType>(item: T) {
  return z.object({
    count: z.number().int().nonnegative(),
    next: z.string().nullable(),
    previous: z.string().nullable(),
    results: z.array(item),
  });
}

export const bookmarkPageSchema = pageSchema(bookmarkSchema);
export const tagPageSchema = pageSchema(tagSchema);
export const bundlePageSchema = pageSchema(bundleSchema);
export const assetPageSchema = pageSchema(assetSchema);
