export const BOOKMARK = {
  id: 1,
  url: "https://example.com",
  title: "Example title",
  description: "Example description",
  notes: "Example notes",
  web_archive_snapshot_url: "https://web.archive.org/web/20200926094623/https://example.com",
  favicon_url: null,
  preview_image_url: null,
  is_archived: false,
  unread: false,
  shared: false,
  tag_names: ["tag1", "tag2"],
  date_added: "2020-09-26T09:46:23.006313Z",
  date_modified: "2020-09-26T16:01:14.275335Z",
  website_title: null,
  website_description: null,
};

export const TAG = {
  id: 7,
  name: "tag1",
  date_added: "2020-09-26T09:46:23.006313Z",
};

export const BUNDLE = {
  id: 3,
  name: "Work Resources",
  search: "productivity tools",
  any_tags: "work productivity",
  all_tags: "",
  excluded_tags: "personal",
  filter_unread: "off",
  filter_shared: "off",
  order: 0,
  date_created: "2020-09-26T09:46:23.006313Z",
  date_modified: "2020-09-26T16:01:14.275335Z",
};

export const ASSET = {
  id: 2,
  bookmark: 1,
  date_created: "2023-10-01T12:05:00Z",
  file_size: 12,
  asset_type: "upload",
  content_type: "text/plain",
  display_name: "notes.txt",
  status: "complete",
};

export const PROFILE = {
  theme: "auto",
  bookmark_date_display: "relative",
  bookmark_link_target: "_blank",
  web_archive_integration: "enabled",
  tag_search: "lax",
  enable_sharing: true,
  enable_public_sharing: false,
  enable_favicons: false,
  display_url: false,
  permanent_notes: false,
  search_preferences: { sort: "title_asc", shared: "off", unread: "off" },
  version: "1.47.0",
};

export function page<T>(
  results: T[],
  next: string | null = null,
  previous: string | null = null,
  count = results.length,
): { count: number; next: string | null; previous: string | null; results: T[] } {
  return { count, next, previous, results };
}
