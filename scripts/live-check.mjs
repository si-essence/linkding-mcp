#!/usr/bin/env node
/**
 * Live check against a local Linkding. Spawns dist/index.js over stdio.
 * Prints a pass/fail line per tool. Does not print the API token.
 */
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const token = process.env["LINKDING_API_TOKEN"] ?? "";
const baseUrl = process.env["LINKDING_URL"] ?? "";

/** @type {string[]} */
const secrets = [];
if (token.length >= 8) secrets.push(token);

/**
 * @param {string} text
 */
function redact(text) {
  let out = String(text);
  for (const secret of secrets) {
    out = out.split(secret).join("[redacted]");
    out = out.split(encodeURIComponent(secret)).join("[redacted]");
  }
  out = out.replace(/Authorization:\s*Token\s+\S+/gi, "Authorization: Token [redacted]");
  out = out.replace(/Authorization:\s*Bearer\s+\S+/gi, "Authorization: Bearer [redacted]");
  return out;
}

/**
 * @param {string} text
 */
function clip(text) {
  let shortened = redact(text).replace(/\s+/g, " ").trim();
  if (shortened.length > 160) shortened = `${shortened.slice(0, 157)}...`;
  return shortened;
}

const writeLine = console.log.bind(console);
const writeError = console.error.bind(console);
console.log = (line) => writeLine(redact(String(line)));
console.error = (line) => writeError(redact(String(line)));

let failed = 0;
/** @type {string[]} */
const rows = [];

/**
 * @param {string} name
 * @param {boolean} ok
 * @param {string} detail
 */
function record(name, ok, detail) {
  if (!ok) failed += 1;
  rows.push(`${ok ? "PASS" : "FAIL"}  ${name}  ${clip(detail)}`);
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {import("@modelcontextprotocol/sdk/client/index.js").Client} client
 * @param {string} name
 * @param {Record<string, unknown>} args
 */
async function call(client, name, args) {
  const result = await client.callTool({ name, arguments: args });
  const block = Array.isArray(result.content) ? result.content[0] : undefined;
  const text = block && typeof block === "object" && "text" in block ? String(block.text) : "";
  if (text.includes(token) && token.length >= 8) {
    throw new Error(`${name} output contained the API token`);
  }
  const isError = result.isError === true;
  /** @type {Record<string, unknown> | null} */
  let json = null;
  if (!isError && text.length > 0) {
    const parsed = JSON.parse(text);
    json = isRecord(parsed) ? parsed : null;
  }
  return { text, isError, json };
}

/**
 * @param {boolean} allowWrites
 */
function childEnv(allowWrites) {
  /** @type {Record<string, string>} */
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value === "string") env[key] = value;
  }
  env["LINKDING_URL"] = baseUrl;
  env["LINKDING_API_TOKEN"] = token;
  env["LINKDING_ALLOW_WRITES"] = allowWrites ? "true" : "false";
  env["LINKDING_CACHE_TTL_SEC"] = "0";
  env["LINKDING_PER_MINUTE"] = "600";
  env["LINKDING_TIMEOUT_MS"] = "60000";
  env["MCP_TRANSPORT"] = "stdio";
  return env;
}

/**
 * @param {boolean} allowWrites
 */
async function connect(allowWrites) {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["dist/index.js"],
    cwd: root,
    env: childEnv(allowWrites),
    stderr: "pipe",
  });
  const stderr = transport.stderr;
  if (stderr && "on" in stderr) {
    stderr.on("data", (chunk) => {
      const text = clip(String(chunk));
      if (text.includes("NO_COLOR") && text.includes("FORCE_COLOR")) return;
      if (text.length === 0) return;
      console.error(`server_stderr ${text}`);
    });
  }
  const client = new Client({ name: "linkding-live-check", version: "0" });
  await client.connect(transport);
  return { client, transport };
}

/**
 * @param {Record<string, unknown> | null} json
 */
function idOf(json) {
  if (!isRecord(json)) return undefined;
  const inner =
    json["bookmark"] ?? json["tag"] ?? json["bundle"] ?? json["asset"] ?? json["result"];
  const source = isRecord(inner) ? inner : json;
  const nested = isRecord(source["bookmark"])
    ? source["bookmark"]
    : isRecord(source["tag"])
      ? source["tag"]
      : isRecord(source["bundle"])
        ? source["bundle"]
        : isRecord(source["asset"])
          ? source["asset"]
          : source;
  const id = nested["id"];
  return typeof id === "number" ? id : undefined;
}

async function main() {
  if (!baseUrl.startsWith("http://127.0.0.1:")) {
    console.log("FAIL  startup  LINKDING_URL must be http://127.0.0.1:<port>");
    process.exit(2);
  }
  if (token.length < 8) {
    console.log("FAIL  startup  LINKDING_API_TOKEN is missing");
    process.exit(2);
  }

  const stamp = Date.now();
  const urlA = `https://example.com/linkding-live-${stamp}-a`;
  const urlB = `https://example.com/linkding-live-${stamp}-b`;
  const directory = await mkdtemp(join(tmpdir(), "linkding-live-"));
  const filePath = join(directory, "note.txt");
  await writeFile(filePath, `live note ${stamp}\n`);

  const writable = await connect(true);
  const readonly = await connect(false);
  try {
    const listed = await writable.client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    record(
      "tool_list",
      names.length === 26 && names.includes("linkding_changes_since"),
      `count=${names.length}`,
    );

    const profile = await call(writable.client, "linkding_get_profile", {});
    record(
      "linkding_get_profile",
      !profile.isError && isRecord(profile.json?.["profile"]),
      profile.isError
        ? profile.text
        : `theme=${String(isRecord(profile.json?.["profile"]) ? profile.json?.["profile"]?.["theme"] : "")}`,
    );

    const emptyLists = [
      ["linkding_list_bookmarks", {}],
      ["linkding_list_archived_bookmarks", {}],
      ["linkding_list_shared_bookmarks", { user: "live" }],
      ["linkding_list_tags", {}],
      ["linkding_list_bundles", {}],
    ];
    for (const [name, args] of emptyLists) {
      const result = await call(writable.client, name, args);
      const count = result.json?.["count"];
      record(
        name,
        !result.isError && typeof count === "number",
        result.isError ? result.text : `count=${count}`,
      );
    }

    const checkedBefore = await call(writable.client, "linkding_check_bookmark_url", {
      url: urlA,
      ignore_cache: true,
    });
    record(
      "linkding_check_bookmark_url",
      !checkedBefore.isError && checkedBefore.json?.["bookmark"] === null,
      checkedBefore.isError ? checkedBefore.text : "bookmark=null",
    );

    const preview = await call(writable.client, "linkding_create_bookmark", {
      url: urlA,
      title: "Live A",
      tag_names: [`live-${stamp}`],
    });
    record(
      "linkding_create_bookmark_dry_run",
      preview.json?.["executed"] === false && preview.json?.["dry_run"] === true,
      preview.isError ? preview.text : `executed=${String(preview.json?.["executed"])}`,
    );

    const blocked = await call(readonly.client, "linkding_create_bookmark", {
      url: urlA,
      title: "Live A",
      confirm: true,
    });
    record(
      "linkding_create_bookmark_blocked",
      blocked.json?.["blocked"] === true && blocked.json?.["executed"] === false,
      blocked.isError ? blocked.text : `blocked=${String(blocked.json?.["blocked"])}`,
    );

    const created = await call(writable.client, "linkding_create_bookmark", {
      url: urlA,
      title: "Live A",
      description: "Created by live-check",
      notes: "note",
      unread: true,
      tag_names: [`live-${stamp}`],
      disable_scraping: true,
      disable_html_snapshot: true,
      confirm: true,
    });
    const bookmarkId = idOf(created.json);
    record(
      "linkding_create_bookmark",
      created.json?.["executed"] === true && bookmarkId !== undefined,
      created.isError ? created.text : `id=${bookmarkId ?? "missing"}`,
    );

    const got = await call(writable.client, "linkding_get_bookmark", { id: bookmarkId ?? 0 });
    record(
      "linkding_get_bookmark",
      !got.isError && idOf(got.json) === bookmarkId,
      got.isError ? got.text : `id=${idOf(got.json) ?? "missing"}`,
    );

    const missing = await call(writable.client, "linkding_get_bookmark", { id: 2147483646 });
    record(
      "linkding_get_bookmark_missing",
      missing.isError && missing.text.includes("[not-found]"),
      missing.text,
    );

    const updated = await call(writable.client, "linkding_update_bookmark", {
      id: bookmarkId ?? 0,
      title: "Live A renamed",
      unread: false,
      confirm: true,
    });
    record(
      "linkding_update_bookmark",
      updated.json?.["executed"] === true,
      updated.isError ? updated.text : "patched title",
    );

    const tagCreated = await call(writable.client, "linkding_create_tag", {
      name: `extra-${stamp}`,
      confirm: true,
    });
    const tagId = idOf(tagCreated.json);
    record(
      "linkding_create_tag",
      tagCreated.json?.["executed"] === true && tagId !== undefined,
      tagCreated.isError ? tagCreated.text : `id=${tagId ?? "missing"}`,
    );
    const tagGot = await call(writable.client, "linkding_get_tag", { id: tagId ?? 0 });
    record(
      "linkding_get_tag",
      !tagGot.isError && idOf(tagGot.json) === tagId,
      tagGot.isError ? tagGot.text : `id=${idOf(tagGot.json) ?? "missing"}`,
    );

    const second = await call(writable.client, "linkding_create_bookmark", {
      url: urlB,
      title: "Live B",
      disable_scraping: true,
      disable_html_snapshot: true,
      confirm: true,
    });
    const secondId = idOf(second.json);
    record(
      "linkding_create_bookmark_second",
      second.json?.["executed"] === true && secondId !== undefined,
      second.isError ? second.text : `id=${secondId ?? "missing"}`,
    );

    const paged = await call(writable.client, "linkding_list_bookmarks", {
      q: `linkding-live-${stamp}`,
      limit: 1,
    });
    const next = paged.json?.["next"];
    record(
      "linkding_list_bookmarks_page",
      !paged.isError && isRecord(next) && next["offset"] === 1,
      paged.isError
        ? paged.text
        : `next_offset=${isRecord(next) ? String(next["offset"]) : "none"}`,
    );

    const archived = await call(writable.client, "linkding_archive_bookmark", {
      id: bookmarkId ?? 0,
      confirm: true,
    });
    record(
      "linkding_archive_bookmark",
      archived.json?.["executed"] === true,
      archived.isError ? archived.text : "archived",
    );
    const archivedList = await call(writable.client, "linkding_list_archived_bookmarks", {
      q: `linkding-live-${stamp}-a`,
    });
    const archivedResults = archivedList.json?.["results"];
    record(
      "linkding_list_archived_bookmarks_found",
      !archivedList.isError && Array.isArray(archivedResults) && archivedResults.length === 1,
      archivedList.isError ? archivedList.text : `count=${archivedList.json?.["count"]}`,
    );
    const restored = await call(writable.client, "linkding_unarchive_bookmark", {
      id: bookmarkId ?? 0,
      confirm: true,
    });
    record(
      "linkding_unarchive_bookmark",
      restored.json?.["executed"] === true,
      restored.isError ? restored.text : "unarchived",
    );

    const bundle = await call(writable.client, "linkding_create_bundle", {
      name: `Live ${stamp}`,
      search: `linkding-live-${stamp}`,
      any_tags: `live-${stamp}`,
      confirm: true,
    });
    const bundleId = idOf(bundle.json);
    record(
      "linkding_create_bundle",
      bundle.json?.["executed"] === true && bundleId !== undefined,
      bundle.isError ? bundle.text : `id=${bundleId ?? "missing"}`,
    );
    const bundleGot = await call(writable.client, "linkding_get_bundle", { id: bundleId ?? 0 });
    record(
      "linkding_get_bundle",
      !bundleGot.isError && idOf(bundleGot.json) === bundleId,
      bundleGot.isError ? bundleGot.text : `id=${idOf(bundleGot.json) ?? "missing"}`,
    );
    const bundleUpdated = await call(writable.client, "linkding_update_bundle", {
      id: bundleId ?? 0,
      search: `linkding-live-${stamp}-a`,
      confirm: true,
    });
    record(
      "linkding_update_bundle",
      bundleUpdated.json?.["executed"] === true,
      bundleUpdated.isError ? bundleUpdated.text : "patched search",
    );

    const bundled = await call(writable.client, "linkding_list_bookmarks", {
      bundle: bundleId ?? 0,
    });
    record(
      "linkding_list_bookmarks_bundle",
      !bundled.isError && typeof bundled.json?.["count"] === "number",
      bundled.isError ? bundled.text : `count=${bundled.json?.["count"]}`,
    );

    const since = await call(writable.client, "linkding_changes_since", {
      since: "2020-01-01T00:00:00Z",
      field: "added_since",
      scope: "both",
      limit: 50,
      max_pages: 5,
    });
    const changed = since.json?.["bookmarks"];
    record(
      "linkding_changes_since",
      !since.isError && Array.isArray(changed) && changed.length >= 1,
      since.isError ? since.text : `bookmarks=${Array.isArray(changed) ? changed.length : 0}`,
    );

    const uploadPreview = await call(writable.client, "linkding_upload_asset", {
      bookmark_id: bookmarkId ?? 0,
      file_path: filePath,
    });
    record(
      "linkding_upload_asset_dry_run",
      uploadPreview.json?.["executed"] === false &&
        isRecord(uploadPreview.json?.["body"]) &&
        uploadPreview.json?.["body"]?.["file"] === "note.txt",
      uploadPreview.isError ? uploadPreview.text : "preview",
    );
    const uploaded = await call(writable.client, "linkding_upload_asset", {
      bookmark_id: bookmarkId ?? 0,
      file_path: filePath,
      confirm: true,
    });
    const assetId = idOf(uploaded.json);
    record(
      "linkding_upload_asset",
      uploaded.json?.["executed"] === true && assetId !== undefined,
      uploaded.isError ? uploaded.text : `id=${assetId ?? "missing"}`,
    );
    const assets = await call(writable.client, "linkding_list_assets", {
      bookmark_id: bookmarkId ?? 0,
    });
    record(
      "linkding_list_assets",
      !assets.isError &&
        typeof assets.json?.["count"] === "number" &&
        Number(assets.json?.["count"]) >= 1,
      assets.isError ? assets.text : `count=${assets.json?.["count"]}`,
    );
    const asset = await call(writable.client, "linkding_get_asset", {
      bookmark_id: bookmarkId ?? 0,
      asset_id: assetId ?? 0,
    });
    record(
      "linkding_get_asset",
      !asset.isError && idOf(asset.json) === assetId,
      asset.isError ? asset.text : `id=${idOf(asset.json) ?? "missing"}`,
    );
    const downloaded = await call(writable.client, "linkding_download_asset", {
      bookmark_id: bookmarkId ?? 0,
      asset_id: assetId ?? 0,
    });
    const included = downloaded.json?.["included_text"];
    record(
      "linkding_download_asset",
      !downloaded.isError && typeof included === "string" && included.includes("live note"),
      downloaded.isError
        ? downloaded.text
        : `omitted=${String(downloaded.json?.["omitted_reason"])}`,
    );

    const assetDeleted = await call(writable.client, "linkding_delete_asset", {
      bookmark_id: bookmarkId ?? 0,
      asset_id: assetId ?? 0,
      confirm: true,
    });
    record(
      "linkding_delete_asset",
      assetDeleted.json?.["executed"] === true,
      assetDeleted.isError ? assetDeleted.text : "deleted",
    );
    const bundleDeleted = await call(writable.client, "linkding_delete_bundle", {
      id: bundleId ?? 0,
      confirm: true,
    });
    record(
      "linkding_delete_bundle",
      bundleDeleted.json?.["executed"] === true,
      bundleDeleted.isError ? bundleDeleted.text : "deleted",
    );
    const tagDeleted = await call(writable.client, "linkding_delete_tag", {
      id: tagId ?? 0,
      confirm: true,
    });
    record(
      "linkding_delete_tag",
      tagDeleted.json?.["executed"] === true,
      tagDeleted.isError ? tagDeleted.text : "deleted",
    );

    const deletePreview = await call(writable.client, "linkding_delete_bookmark", {
      id: bookmarkId ?? 0,
    });
    const stillThere = await call(writable.client, "linkding_get_bookmark", {
      id: bookmarkId ?? 0,
    });
    record(
      "linkding_delete_bookmark_dry_run",
      deletePreview.json?.["executed"] === false && !stillThere.isError,
      deletePreview.isError ? deletePreview.text : "still present",
    );
    const blockedDelete = await call(readonly.client, "linkding_delete_bookmark", {
      id: bookmarkId ?? 0,
      confirm: true,
    });
    const stillAfterBlock = await call(writable.client, "linkding_get_bookmark", {
      id: bookmarkId ?? 0,
    });
    record(
      "linkding_delete_bookmark_blocked",
      blockedDelete.json?.["blocked"] === true && !stillAfterBlock.isError,
      blockedDelete.isError ? blockedDelete.text : "still present",
    );
    const removedA = await call(writable.client, "linkding_delete_bookmark", {
      id: bookmarkId ?? 0,
      confirm: true,
    });
    const removedB = await call(writable.client, "linkding_delete_bookmark", {
      id: secondId ?? 0,
      confirm: true,
    });
    record(
      "linkding_delete_bookmark",
      removedA.json?.["executed"] === true && removedB.json?.["executed"] === true,
      removedA.isError ? removedA.text : "deleted both",
    );
  } finally {
    await writable.client.close();
    await readonly.client.close();
  }

  console.log("tool                                    result  detail");
  for (const row of rows) console.log(row);
  console.log(`${failed === 0 ? "PASS" : "FAIL"}  ${rows.length - failed}/${rows.length}`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "live check failed";
  console.log(`FAIL  startup  ${clip(message)}`);
  process.exit(1);
});
