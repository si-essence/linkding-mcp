import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z, type ZodObject, type ZodRawShape } from "zod";
import {
  deleteAsset,
  deleteAssetInput,
  downloadAsset,
  getAsset,
  listAssets,
  listAssetsInput,
  assetIdInput,
  uploadAsset,
  uploadAssetInput,
} from "./assets.js";
import { toolDescription, toolName } from "./brand.js";
import {
  archiveBookmark,
  bookmarkIdWriteInput,
  changesSince,
  changesSinceInput,
  checkBookmarkUrl,
  checkBookmarkInput,
  createBookmark,
  createBookmarkInput,
  deleteBookmark,
  getBookmark,
  getBookmarkInput,
  listArchivedBookmarks,
  listBookmarks,
  listBookmarksInput,
  listSharedBookmarks,
  listSharedBookmarksInput,
  unarchiveBookmark,
  updateBookmark,
  updateBookmarkInput,
} from "./bookmarks.js";
import {
  createBundle,
  createBundleInput,
  deleteBundle,
  deleteBundleInput,
  getBundle,
  getBundleInput,
  listBundles,
  listBundlesInput,
  updateBundle,
  updateBundleInput,
} from "./bundles.js";
import { CONNECTOR_NAME, CONNECTOR_TITLE, CONNECTOR_VERSION } from "./constants.js";
import { getProfile, getProfileInput } from "./profile.js";
import type { Runtime } from "./runtime.js";
import {
  createTag,
  createTagInput,
  deleteTag,
  deleteTagInput,
  getTag,
  getTagInput,
  listTags,
  listTagsInput,
} from "./tags.js";
import {
  READ_ONLY_REMOTE,
  WRITE_DESTRUCTIVE,
  WRITE_IDEMPOTENT,
  WRITE_NON_IDEMPOTENT,
  registerConnectorTool,
  type ToolAnnotations,
  type ToolContext,
} from "./tools.js";

function publish<Shape extends ZodRawShape>(
  server: McpServer,
  ctx: ToolContext,
  name: string,
  description: string,
  inputSchema: ZodObject<Shape>,
  annotations: ToolAnnotations,
  handler: (args: z.output<ZodObject<Shape>>) => Promise<Record<string, unknown>>,
): void {
  registerConnectorTool(
    server,
    {
      name: toolName(name),
      description: toolDescription(description),
      inputSchema,
      annotations,
      handler,
    },
    ctx,
  );
}

export function createServer(runtime: Runtime): McpServer {
  const server = new McpServer({
    name: CONNECTOR_NAME,
    title: CONNECTOR_TITLE,
    version: CONNECTOR_VERSION,
  });
  const ctx: ToolContext = { secrets: runtime.secrets, logger: runtime.logger };

  publish(
    server,
    ctx,
    "linkding_list_bookmarks",
    "List active bookmarks. GET /api/bookmarks/ with q, limit, offset, modified_since, added_since, and bundle. Returns count plus next and previous offsets.",
    listBookmarksInput,
    READ_ONLY_REMOTE,
    (args) => listBookmarks(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_list_archived_bookmarks",
    "List archived bookmarks. GET /api/bookmarks/archived/. Filters match linkding_list_bookmarks.",
    listBookmarksInput,
    READ_ONLY_REMOTE,
    (args) => listArchivedBookmarks(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_list_shared_bookmarks",
    "List bookmarks shared by a user. GET /api/bookmarks/shared/. Pass user when you want one person's public bookmarks.",
    listSharedBookmarksInput,
    READ_ONLY_REMOTE,
    (args) => listSharedBookmarks(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_get_bookmark",
    "Get one bookmark by id. GET /api/bookmarks/<id>/.",
    getBookmarkInput,
    READ_ONLY_REMOTE,
    (args) => getBookmark(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_check_bookmark_url",
    "Check whether a URL is already bookmarked. GET /api/bookmarks/check/. Also returns scraped metadata and auto_tags that Linkding would add.",
    checkBookmarkInput,
    READ_ONLY_REMOTE,
    (args) => checkBookmarkUrl(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_create_bookmark",
    "Create a bookmark. POST /api/bookmarks/. Linkding silently updates an existing bookmark when the URL already exists, and it merges auto-tagging rules into tag_names. Omit confirm for a dry-run. confirm true sends the write only when LINKDING_ALLOW_WRITES is true.",
    createBookmarkInput,
    WRITE_NON_IDEMPOTENT,
    (args) => createBookmark(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_update_bookmark",
    "Update a bookmark. PATCH by default, or PUT when replace is true. Omitted fields stay unchanged. Auto-tagging rules are merged into tag_names on every update. Omit confirm for a dry-run.",
    updateBookmarkInput,
    WRITE_IDEMPOTENT,
    (args) => updateBookmark(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_archive_bookmark",
    "Archive a bookmark. POST /api/bookmarks/<id>/archive/. Omit confirm for a dry-run.",
    bookmarkIdWriteInput,
    WRITE_IDEMPOTENT,
    (args) => archiveBookmark(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_unarchive_bookmark",
    "Move a bookmark out of the archive. POST /api/bookmarks/<id>/unarchive/. Omit confirm for a dry-run.",
    bookmarkIdWriteInput,
    WRITE_IDEMPOTENT,
    (args) => unarchiveBookmark(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_delete_bookmark",
    "Delete a bookmark. DELETE /api/bookmarks/<id>/. Omit confirm for a dry-run.",
    bookmarkIdWriteInput,
    WRITE_DESTRUCTIVE,
    (args) => deleteBookmark(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_changes_since",
    "List bookmarks added or modified after a timestamp. Follows next offsets up to max_pages across active bookmarks, archived bookmarks, or both. Deleted bookmarks are not included.",
    changesSinceInput,
    READ_ONLY_REMOTE,
    (args) => changesSince(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_list_tags",
    "List tags. GET /api/tags/ with limit and offset.",
    listTagsInput,
    READ_ONLY_REMOTE,
    (args) => listTags(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_get_tag",
    "Get one tag by id. GET /api/tags/<id>/.",
    getTagInput,
    READ_ONLY_REMOTE,
    (args) => getTag(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_create_tag",
    "Create a tag. POST /api/tags/. Linkding returns the existing tag when the name already exists. Omit confirm for a dry-run.",
    createTagInput,
    WRITE_IDEMPOTENT,
    (args) => createTag(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_delete_tag",
    "Delete a tag. DELETE /api/tags/<id>/. Omit confirm for a dry-run.",
    deleteTagInput,
    WRITE_DESTRUCTIVE,
    (args) => deleteTag(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_list_bundles",
    "List bundles. GET /api/bundles/ with limit and offset. A bundle is a saved search, not a manual list of bookmarks.",
    listBundlesInput,
    READ_ONLY_REMOTE,
    (args) => listBundles(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_get_bundle",
    "Get one bundle by id. GET /api/bundles/<id>/.",
    getBundleInput,
    READ_ONLY_REMOTE,
    (args) => getBundle(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_create_bundle",
    "Create a bundle. POST /api/bundles/. Omit confirm for a dry-run.",
    createBundleInput,
    WRITE_NON_IDEMPOTENT,
    (args) => createBundle(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_update_bundle",
    "Update a bundle. PATCH by default, or PUT when replace is true. Omit confirm for a dry-run.",
    updateBundleInput,
    WRITE_IDEMPOTENT,
    (args) => updateBundle(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_delete_bundle",
    "Delete a bundle. DELETE /api/bundles/<id>/. Bookmarks are not deleted. Omit confirm for a dry-run.",
    deleteBundleInput,
    WRITE_DESTRUCTIVE,
    (args) => deleteBundle(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_list_assets",
    "List assets for one bookmark. GET /api/bookmarks/<bookmark_id>/assets/.",
    listAssetsInput,
    READ_ONLY_REMOTE,
    (args) => listAssets(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_get_asset",
    "Get one bookmark asset. GET /api/bookmarks/<bookmark_id>/assets/<id>/.",
    assetIdInput,
    READ_ONLY_REMOTE,
    (args) => getAsset(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_download_asset",
    "Download a bookmark asset. Returns the text when the file is small and textual. Otherwise returns content type, length, and filename only.",
    assetIdInput,
    READ_ONLY_REMOTE,
    (args) => downloadAsset(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_upload_asset",
    "Upload a local file as a bookmark asset. POST multipart field file to /api/bookmarks/<bookmark_id>/assets/upload/. Omit confirm for a dry-run that names the file and its size.",
    uploadAssetInput,
    WRITE_NON_IDEMPOTENT,
    (args) => uploadAsset(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_delete_asset",
    "Delete a bookmark asset. DELETE /api/bookmarks/<bookmark_id>/assets/<id>/. Omit confirm for a dry-run.",
    deleteAssetInput,
    WRITE_DESTRUCTIVE,
    (args) => deleteAsset(runtime, args),
  );
  publish(
    server,
    ctx,
    "linkding_get_profile",
    "Get the authenticated user's profile. GET /api/user/profile/.",
    getProfileInput,
    READ_ONLY_REMOTE,
    () => getProfile(runtime),
  );

  return server;
}
