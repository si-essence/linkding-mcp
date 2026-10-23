import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { ASSET, BOOKMARK, BUNDLE, PROFILE, TAG, page } from "./fixtures.js";
import { TOKEN, expectAuth, jsonFetch, runtimeFor } from "./harness.js";
import { connectServer } from "./mcp.js";
import { readToolText } from "./result.js";

const TOOL_NAMES = [
  "linkding_archive_bookmark",
  "linkding_changes_since",
  "linkding_check_bookmark_url",
  "linkding_create_bookmark",
  "linkding_create_bundle",
  "linkding_create_tag",
  "linkding_delete_asset",
  "linkding_delete_bookmark",
  "linkding_delete_bundle",
  "linkding_delete_tag",
  "linkding_download_asset",
  "linkding_get_asset",
  "linkding_get_bookmark",
  "linkding_get_bundle",
  "linkding_get_profile",
  "linkding_get_tag",
  "linkding_list_archived_bookmarks",
  "linkding_list_assets",
  "linkding_list_bookmarks",
  "linkding_list_bundles",
  "linkding_list_shared_bookmarks",
  "linkding_list_tags",
  "linkding_unarchive_bookmark",
  "linkding_update_bookmark",
  "linkding_update_bundle",
  "linkding_upload_asset",
];

const WRITE_TOOLS = new Set([
  "linkding_archive_bookmark",
  "linkding_create_bookmark",
  "linkding_create_bundle",
  "linkding_create_tag",
  "linkding_delete_asset",
  "linkding_delete_bookmark",
  "linkding_delete_bundle",
  "linkding_delete_tag",
  "linkding_unarchive_bookmark",
  "linkding_update_bookmark",
  "linkding_update_bundle",
  "linkding_upload_asset",
]);

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function withClient(
  fetchImpl: typeof fetch,
  extra: NodeJS.ProcessEnv,
  run: (client: Client) => Promise<void>,
): Promise<void> {
  const runtime = runtimeFor(fetchImpl, extra);
  const connected = await connectServer(runtime);
  try {
    await run(connected.client);
  } finally {
    await connected.close();
  }
}

async function call(
  client: Client,
  name: string,
  args: Record<string, unknown>,
): Promise<{ text: string; isError: boolean; json: Record<string, unknown> | null }> {
  const result = readToolText(await client.callTool({ name, arguments: args }));
  expect(result.text).not.toContain(TOKEN);
  if (result.isError) return { ...result, json: null };
  return { ...result, json: JSON.parse(result.text) as Record<string, unknown> };
}

describe("linkding tools", () => {
  it("publishes every tool with a description and confirm only on writes", async () => {
    const { fetchImpl } = jsonFetch(() => jsonResponse({}));
    await withClient(fetchImpl, {}, async (client) => {
      const listed = await client.listTools();
      const names = listed.tools.map((tool) => tool.name).sort();
      expect(names).toEqual(TOOL_NAMES);
      for (const tool of listed.tools) {
        expect((tool.description ?? "").trim().length).toBeGreaterThan(20);
        const schema = JSON.stringify(tool.inputSchema);
        if (WRITE_TOOLS.has(tool.name)) expect(schema).toContain("confirm");
        else expect(schema).not.toContain("confirm");
      }
    });
  });

  it("lists bookmarks with token auth, a next offset, and a redacted title", async () => {
    const titled = { ...BOOKMARK, title: `hello ${TOKEN}` };
    const { fetchImpl, calls } = jsonFetch((captured) => {
      expectAuth(captured);
      return jsonResponse(
        page(
          [titled],
          `http://127.0.0.1:8000/api/bookmarks/?limit=1&offset=1&token=${TOKEN}`,
          null,
          2,
        ),
      );
    });
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "linkding_list_bookmarks", {
        q: "example",
        limit: 1,
        modified_since: "2020-01-01T00:00:00Z",
        bundle: 3,
      });
      expect(result.isError).toBe(false);
      expect(result.json).toMatchObject({
        count: 2,
        next: { offset: 1, limit: 1 },
        previous: null,
      });
      const next = result.json?.["next"] as { path: string };
      expect(next.path).not.toContain(TOKEN);
      expect(next.path).toContain("offset=1");
      expect(JSON.stringify(result.json?.["results"])).toContain("[redacted]");
      expect(calls[0]?.url).toContain("/api/bookmarks/?");
      expect(calls[0]?.url).toContain("q=example");
      expect(calls[0]?.url).toContain("bundle=3");
      expect(calls[0]?.method).toBe("GET");
    });
  });

  it("routes archived, shared, get, and check calls", async () => {
    const { fetchImpl, calls } = jsonFetch((captured) => {
      expectAuth(captured);
      const path = new URL(captured.url).pathname;
      if (path.endsWith("/archived/")) return jsonResponse(page([BOOKMARK]));
      if (path.endsWith("/shared/")) return jsonResponse(page([]));
      if (path.endsWith("/check/")) {
        return jsonResponse({
          bookmark: BOOKMARK,
          metadata: { title: "Scraped", description: "From the site" },
          auto_tags: ["news"],
        });
      }
      return jsonResponse(BOOKMARK);
    });
    await withClient(fetchImpl, {}, async (client) => {
      const archived = await call(client, "linkding_list_archived_bookmarks", { limit: 5 });
      const shared = await call(client, "linkding_list_shared_bookmarks", { user: "ada" });
      const got = await call(client, "linkding_get_bookmark", { id: 1 });
      const checked = await call(client, "linkding_check_bookmark_url", {
        url: "https://example.com",
        ignore_cache: true,
      });
      expect(archived.json?.["count"]).toBe(1);
      expect(shared.json?.["results"]).toEqual([]);
      expect(got.json).toMatchObject({ bookmark: { id: 1 } });
      expect(checked.json).toMatchObject({ auto_tags: ["news"] });
      expect(calls.map((callItem) => new URL(callItem.url).pathname)).toEqual([
        "/api/bookmarks/archived/",
        "/api/bookmarks/shared/",
        "/api/bookmarks/1/",
        "/api/bookmarks/check/",
      ]);
      expect(calls[1]?.url).toContain("user=ada");
      expect(calls[3]?.url).toContain("ignore_cache=true");
    });
  });

  it("previews a create and does not send it without confirm or writes", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(BOOKMARK));
    await withClient(fetchImpl, { LINKDING_ALLOW_WRITES: "true" }, async (client) => {
      const preview = await call(client, "linkding_create_bookmark", {
        url: "https://example.com/new",
        title: "New",
        tag_names: ["one"],
      });
      expect(preview.json).toMatchObject({
        executed: false,
        dry_run: true,
        blocked: false,
        method: "POST",
        path: "api/bookmarks/",
        body: { url: "https://example.com/new", title: "New", tag_names: ["one"] },
      });
      expect(preview.text).toContain(
        "Linkding silently updates an existing bookmark when the URL already exists.",
      );
      expect(preview.text).toContain("auto-tagging rules");
      expect(calls).toHaveLength(0);
    });

    const blocked = jsonFetch(() => jsonResponse(BOOKMARK));
    await withClient(blocked.fetchImpl, {}, async (client) => {
      const result = await call(client, "linkding_create_bookmark", {
        url: "https://example.com/new",
        confirm: true,
      });
      expect(result.json).toMatchObject({
        executed: false,
        blocked: true,
        dry_run: true,
      });
      expect(result.text).toContain("LINKDING_ALLOW_WRITES is not true");
      expect(blocked.calls).toHaveLength(0);
    });
  });

  it("creates, patches, archives, unarchives, and deletes only after confirm", async () => {
    const { fetchImpl, calls } = jsonFetch((captured) => {
      expectAuth(captured);
      const path = new URL(captured.url).pathname;
      if (captured.method === "POST" && path === "/api/bookmarks/") {
        return jsonResponse({ ...BOOKMARK, url: "https://example.com/new" }, 201);
      }
      if (captured.method === "PATCH") return jsonResponse({ ...BOOKMARK, title: "Renamed" });
      return new Response(null, { status: 204 });
    });
    await withClient(fetchImpl, { LINKDING_ALLOW_WRITES: "true" }, async (client) => {
      const created = await call(client, "linkding_create_bookmark", {
        url: "https://example.com/new",
        disable_scraping: true,
        confirm: true,
      });
      const updated = await call(client, "linkding_update_bookmark", {
        id: 1,
        title: "Renamed",
        confirm: true,
      });
      const archived = await call(client, "linkding_archive_bookmark", { id: 1, confirm: true });
      const restored = await call(client, "linkding_unarchive_bookmark", { id: 1, confirm: true });
      const removed = await call(client, "linkding_delete_bookmark", { id: 1, confirm: true });
      expect(created.json).toMatchObject({ executed: true, dry_run: false });
      expect(updated.json).toMatchObject({ executed: true });
      expect(archived.json).toMatchObject({
        result: { bookmark_id: 1, is_archived: true, status: 204 },
      });
      expect(restored.json).toMatchObject({ result: { is_archived: false } });
      expect(removed.json).toMatchObject({ result: { deleted: true, status: 204 } });
      expect(calls.map((item) => `${item.method} ${new URL(item.url).pathname}`)).toEqual([
        "POST /api/bookmarks/",
        "PATCH /api/bookmarks/1/",
        "POST /api/bookmarks/1/archive/",
        "POST /api/bookmarks/1/unarchive/",
        "DELETE /api/bookmarks/1/",
      ]);
      expect(calls[0]?.url).toContain("disable_scraping=true");
      expect(calls[1]?.body).toEqual({ title: "Renamed" });
      expect(calls[1]?.contentType).toContain("application/json");
    });
  });

  it("rejects confirm false and a PUT that omits url", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(BOOKMARK));
    await withClient(fetchImpl, { LINKDING_ALLOW_WRITES: "true" }, async (client) => {
      const badConfirm = await call(client, "linkding_delete_bookmark", {
        id: 1,
        confirm: false,
      });
      const badPut = await call(client, "linkding_update_bookmark", {
        id: 1,
        title: "Only title",
        replace: true,
        confirm: true,
      });
      expect(badConfirm.isError).toBe(true);
      expect(badConfirm.text).toContain("confirm must be the boolean true");
      expect(badPut.isError).toBe(true);
      expect(badPut.text).toContain("PUT (replace true) also requires url");
      expect(calls).toHaveLength(0);
    });
  });

  it("follows next offsets for changes since a timestamp", async () => {
    const second = { ...BOOKMARK, id: 2, url: "https://example.com/2" };
    const { fetchImpl, calls } = jsonFetch((captured) => {
      const url = new URL(captured.url);
      if (url.pathname.endsWith("/archived/")) return jsonResponse(page([second]));
      if (url.searchParams.get("offset") === "1") return jsonResponse(page([second]));
      return jsonResponse(
        page([BOOKMARK], "http://linkding.test/api/bookmarks/?limit=1&offset=1", null, 2),
      );
    });
    await withClient(fetchImpl, {}, async (client) => {
      const active = await call(client, "linkding_changes_since", {
        since: "2026-01-01T00:00:00Z",
        limit: 1,
        max_pages: 5,
      });
      expect(active.json).toMatchObject({
        field: "modified_since",
        scope: "active",
        complete: true,
        pages_fetched: 2,
      });
      const bookmarks = active.json?.["bookmarks"];
      expect(Array.isArray(bookmarks) ? bookmarks.length : 0).toBe(2);

      const both = await call(client, "linkding_changes_since", {
        since: "2026-01-01T00:00:00Z",
        field: "added_since",
        scope: "both",
        max_pages: 1,
      });
      expect(both.json).toMatchObject({
        complete: false,
        pages_fetched: 1,
        truncated_scope: "active",
      });
      expect(calls.some((item) => item.url.includes("added_since="))).toBe(true);
      expect(calls.some((item) => item.url.includes("/archived/"))).toBe(false);
    });
  });

  it("covers tags and bundles, including a dry-run delete", async () => {
    const { fetchImpl, calls } = jsonFetch((captured) => {
      expectAuth(captured);
      if (captured.method === "GET" && captured.url.includes("/api/tags/")) {
        if (captured.url.endsWith("/7/")) return jsonResponse(TAG);
        return jsonResponse(page([TAG]));
      }
      if (captured.method === "POST" && captured.url.endsWith("/api/tags/")) {
        return jsonResponse(TAG, 201);
      }
      if (captured.method === "GET" && captured.url.includes("/api/bundles/")) {
        if (captured.url.endsWith("/3/")) return jsonResponse(BUNDLE);
        return jsonResponse(page([BUNDLE]));
      }
      if (captured.method === "POST") return jsonResponse(BUNDLE, 201);
      if (captured.method === "PATCH") return jsonResponse({ ...BUNDLE, name: "Renamed" });
      return new Response(null, { status: 204 });
    });
    await withClient(fetchImpl, { LINKDING_ALLOW_WRITES: "true" }, async (client) => {
      expect((await call(client, "linkding_list_tags", { limit: 10 })).json?.["count"]).toBe(1);
      expect((await call(client, "linkding_get_tag", { id: 7 })).json).toMatchObject({
        tag: { name: "tag1" },
      });
      const tagPreview = await call(client, "linkding_create_tag", { name: "tag1" });
      expect(tagPreview.json).toMatchObject({ executed: false, body: { name: "tag1" } });
      expect(tagPreview.text).toContain("returns the existing tag");
      const tagCreated = await call(client, "linkding_create_tag", { name: "tag1", confirm: true });
      expect(tagCreated.json).toMatchObject({ executed: true });
      const tagDryDelete = await call(client, "linkding_delete_tag", { id: 7 });
      expect(tagDryDelete.json).toMatchObject({ method: "DELETE", executed: false });
      await call(client, "linkding_delete_tag", { id: 7, confirm: true });

      expect((await call(client, "linkding_list_bundles", {})).json?.["count"]).toBe(1);
      expect((await call(client, "linkding_get_bundle", { id: 3 })).json).toMatchObject({
        bundle: { id: 3 },
      });
      const bundle = await call(client, "linkding_create_bundle", {
        name: "Work Resources",
        any_tags: "work",
        confirm: true,
      });
      expect(bundle.json).toMatchObject({ executed: true });
      const renamed = await call(client, "linkding_update_bundle", {
        id: 3,
        name: "Renamed",
        confirm: true,
      });
      expect(renamed.json).toMatchObject({ executed: true });
      const removed = await call(client, "linkding_delete_bundle", { id: 3, confirm: true });
      expect(removed.json).toMatchObject({ result: { deleted: true } });
      expect(calls.filter((item) => item.method === "DELETE").map((item) => item.url)).toEqual([
        "https://linkding.test/api/tags/7/",
        "https://linkding.test/api/bundles/3/",
      ]);
    });
  });

  it("lists, gets, downloads, uploads, and deletes assets", async () => {
    const directory = await mkdtemp(join(tmpdir(), "linkding-asset-"));
    const filePath = join(directory, "notes.txt");
    await writeFile(filePath, "hello asset");
    const { fetchImpl, calls } = jsonFetch((captured) => {
      expectAuth(captured);
      if (captured.method === "GET" && captured.url.endsWith("/download/")) {
        return new Response("hello asset", {
          status: 200,
          headers: {
            "content-type": "text/plain; charset=utf-8",
            "content-disposition": 'attachment; filename="notes.txt"',
          },
        });
      }
      if (captured.method === "GET" && captured.url.endsWith("/assets/")) {
        return jsonResponse(page([ASSET]));
      }
      if (captured.method === "GET") return jsonResponse(ASSET);
      if (captured.method === "POST") return jsonResponse(ASSET, 201);
      return new Response(null, { status: 204 });
    });
    await withClient(fetchImpl, { LINKDING_ALLOW_WRITES: "true" }, async (client) => {
      const listed = await call(client, "linkding_list_assets", { bookmark_id: 1 });
      const got = await call(client, "linkding_get_asset", { bookmark_id: 1, asset_id: 2 });
      const downloaded = await call(client, "linkding_download_asset", {
        bookmark_id: 1,
        asset_id: 2,
      });
      const preview = await call(client, "linkding_upload_asset", {
        bookmark_id: 1,
        file_path: filePath,
      });
      const uploaded = await call(client, "linkding_upload_asset", {
        bookmark_id: 1,
        file_path: filePath,
        confirm: true,
      });
      const removed = await call(client, "linkding_delete_asset", {
        bookmark_id: 1,
        asset_id: 2,
        confirm: true,
      });
      expect(listed.json?.["count"]).toBe(1);
      expect(got.json).toMatchObject({ asset: { id: 2, bookmark: 1 } });
      expect(downloaded.json).toMatchObject({
        included_text: "hello asset",
        omitted_reason: null,
        filename: "notes.txt",
      });
      expect(preview.json).toMatchObject({
        executed: false,
        body: { file: "notes.txt", bytes: 11, content_type: "text/plain" },
      });
      expect(uploaded.json).toMatchObject({ executed: true });
      expect(removed.json).toMatchObject({ result: { deleted: true } });
      const upload = calls.find((item) => item.method === "POST");
      expect(upload?.body).toBeInstanceOf(FormData);
      expect(upload?.url).toBe("https://linkding.test/api/bookmarks/1/assets/upload/");
    });
  });

  it("returns metadata only for a binary or oversized download", async () => {
    const { fetchImpl } = jsonFetch((captured) => {
      if (captured.url.endsWith("/9/download/")) {
        return new Response("not-text", {
          status: 200,
          headers: { "content-type": "image/png", "content-length": "8" },
        });
      }
      return new Response("x", {
        status: 200,
        headers: { "content-type": "text/html", "content-length": "40000" },
      });
    });
    await withClient(fetchImpl, {}, async (client) => {
      const binary = await call(client, "linkding_download_asset", {
        bookmark_id: 1,
        asset_id: 9,
      });
      const large = await call(client, "linkding_download_asset", {
        bookmark_id: 1,
        asset_id: 8,
      });
      expect(binary.json).toMatchObject({
        included_text: null,
        omitted_reason: "binary",
        content_type: "image/png",
      });
      expect(binary.text).not.toContain("not-text");
      expect(large.json).toMatchObject({ included_text: null, omitted_reason: "too_large" });
    });
  });

  it("reads the user profile", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(PROFILE));
    await withClient(fetchImpl, {}, async (client) => {
      const result = await call(client, "linkding_get_profile", {});
      expect(result.json).toMatchObject({ profile: { theme: "auto", version: "1.47.0" } });
      expect(calls[0]?.url).toBe("https://linkding.test/api/user/profile/");
    });
  });

  it("maps upstream statuses onto connector error codes", async () => {
    const cases: { status: number; prefix: string; body: string }[] = [
      { status: 401, prefix: "[unauthorized]", body: `denied ${TOKEN}` },
      { status: 403, prefix: "[unauthorized]", body: "Asset upload is disabled." },
      { status: 404, prefix: "[not-found]", body: "missing" },
      { status: 400, prefix: "[invalid-input]", body: '{"url":["already exists"]}' },
      { status: 429, prefix: "[rate-limited]", body: `slow ${TOKEN}` },
      { status: 500, prefix: "[upstream-unavailable]", body: "boom" },
      { status: 503, prefix: "[upstream-unavailable]", body: "down" },
    ];
    let index = 0;
    const { fetchImpl } = jsonFetch(() => {
      const current = cases[index];
      index += 1;
      if (current === undefined) return jsonResponse(BOOKMARK);
      const init: ResponseInit = { status: current.status };
      if (current.status === 429) init.headers = { "retry-after": "4" };
      return new Response(current.body, init);
    });
    await withClient(fetchImpl, {}, async (client) => {
      for (const current of cases) {
        const result = await call(client, "linkding_get_bookmark", { id: 1 });
        expect(result.isError).toBe(true);
        expect(result.text.startsWith(current.prefix)).toBe(true);
        expect(result.text).not.toContain(TOKEN);
      }
    });
  });

  it("blocks the next uncached call when the local window is full", async () => {
    const { fetchImpl } = jsonFetch(() => jsonResponse(page([BOOKMARK])));
    await withClient(
      fetchImpl,
      { LINKDING_PER_MINUTE: "1", LINKDING_CACHE_TTL_SEC: "0" },
      async (client) => {
        const first = await call(client, "linkding_list_bookmarks", {});
        const second = await call(client, "linkding_list_bookmarks", { q: "other" });
        expect(first.isError).toBe(false);
        expect(second.isError).toBe(true);
        expect(second.text).toContain("[rate-limited]");
      },
    );
  });

  it("does not call upstream when the token is missing", async () => {
    const { fetchImpl, calls } = jsonFetch(() => jsonResponse(page([BOOKMARK])));
    const runtime = runtimeFor(fetchImpl, { LINKDING_API_TOKEN: "" });
    const connected = await connectServer(runtime);
    try {
      const result = readToolText(
        await connected.client.callTool({ name: "linkding_list_bookmarks", arguments: {} }),
      );
      expect(result.isError).toBe(true);
      expect(result.text).toContain("[config]");
      expect(result.text).toContain("LINKDING_API_TOKEN");
      expect(calls).toHaveLength(0);
    } finally {
      await connected.close();
    }
  });
});
