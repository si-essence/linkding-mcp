# linkding-mcp

An MCP (Model Context Protocol) server that connects AI assistants to a self-hosted [Linkding](https://github.com/sissbruecker/linkding) bookmark manager through its REST API. It has 26 tools for bookmarks, tags, bundles, assets, and the user profile. Writes are dry-run previews unless you confirm them and enable writes. It runs over stdio, or over stateless Streamable HTTP on localhost.

**Connects to:** your own Linkding instance, using a Linkding API token.

By Issah Abubakari ([@si-essence](https://github.com/si-essence)). Also listed on [Bot Essentials](https://bot-essentials.netlify.app).

Linkding is MIT software. There is no hosted service and no separate terms of use. This connector does not grant any right to Linkding's name or to imply that the Linkding project endorses it.

Works with Linkding, not affiliated with or endorsed by the Linkding project.

## Requirements

- Node.js 20 or newer (CI uses Node.js 22)
- npm

## What this covers

This connector covers the bookmark, tag, bundle, asset, and profile resources in the [Linkding API](https://linkding.link/api/), including archive, update, delete, URL check, bundles, asset upload and download, and a changes-since sync. Writes stay as a dry-run until you pass `confirm: true`, and they stay off unless `LINKDING_ALLOW_WRITES` is the literal `true`.

`POST /api/bookmarks/singlefile/` is the browser extension snapshot upload. It is not a tool here. Use `linkding_upload_asset` for a file you already have, and `linkding_create_bookmark` for the URL.

## Setup

From a clone of this repository:

```bash
npm ci
npm run ci
npm start
npm run start:http
```

`npm start` speaks stdio. `npm run start:http` serves Streamable HTTP at `http://127.0.0.1:3000/mcp` and `GET /health`. HTTP mode has no authentication. Keep it on localhost.

```json
{
  "mcpServers": {
    "linkding": {
      "command": "node",
      "args": ["/path/to/linkding-mcp/dist/index.js"],
      "env": {
        "LINKDING_URL": "http://127.0.0.1:9090",
        "LINKDING_API_TOKEN": "...",
        "LINKDING_ALLOW_WRITES": "false",
        "LINKDING_CONTACT": "you@example.com"
      }
    }
  }
}
```

Create the API token in Linkding under Settings, Integrations. The connector sends it as `Authorization: Token <token>` and never prints it.

Docker (HTTP, no authentication, localhost only):

```bash
docker build -t linkding-mcp .
docker run -p 3000:3000 \
  -e LINKDING_URL=http://host.docker.internal:9090 \
  -e LINKDING_API_TOKEN=... \
  linkding-mcp
```

Do not put the token in the image.

## Tools

| Tool                               | Call                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------- |
| `linkding_list_bookmarks`          | `GET /api/bookmarks/` with `q`, `limit`, `offset`, `modified_since`, `added_since`, `bundle` |
| `linkding_list_archived_bookmarks` | `GET /api/bookmarks/archived/`                                                               |
| `linkding_list_shared_bookmarks`   | `GET /api/bookmarks/shared/`                                                                 |
| `linkding_get_bookmark`            | `GET /api/bookmarks/<id>/`                                                                   |
| `linkding_check_bookmark_url`      | `GET /api/bookmarks/check/`                                                                  |
| `linkding_create_bookmark`         | `POST /api/bookmarks/`                                                                       |
| `linkding_update_bookmark`         | `PATCH` or `PUT /api/bookmarks/<id>/`                                                        |
| `linkding_archive_bookmark`        | `POST /api/bookmarks/<id>/archive/`                                                          |
| `linkding_unarchive_bookmark`      | `POST /api/bookmarks/<id>/unarchive/`                                                        |
| `linkding_delete_bookmark`         | `DELETE /api/bookmarks/<id>/`                                                                |
| `linkding_changes_since`           | Active and archived lists filtered by `modified_since` or `added_since`, following `next`    |
| `linkding_list_tags`               | `GET /api/tags/`                                                                             |
| `linkding_get_tag`                 | `GET /api/tags/<id>/`                                                                        |
| `linkding_create_tag`              | `POST /api/tags/`                                                                            |
| `linkding_delete_tag`              | `DELETE /api/tags/<id>/`                                                                     |
| `linkding_list_bundles`            | `GET /api/bundles/`                                                                          |
| `linkding_get_bundle`              | `GET /api/bundles/<id>/`                                                                     |
| `linkding_create_bundle`           | `POST /api/bundles/`                                                                         |
| `linkding_update_bundle`           | `PATCH` or `PUT /api/bundles/<id>/`                                                          |
| `linkding_delete_bundle`           | `DELETE /api/bundles/<id>/`                                                                  |
| `linkding_list_assets`             | `GET /api/bookmarks/<bookmark_id>/assets/`                                                   |
| `linkding_get_asset`               | `GET /api/bookmarks/<bookmark_id>/assets/<id>/`                                              |
| `linkding_download_asset`          | Download. Small text is returned. Binary and large files return metadata only                |
| `linkding_upload_asset`            | `POST` multipart field `file` to `/api/bookmarks/<bookmark_id>/assets/upload/`               |
| `linkding_delete_asset`            | `DELETE /api/bookmarks/<bookmark_id>/assets/<id>/`                                           |
| `linkding_get_profile`             | `GET /api/user/profile/`                                                                     |

List tools return `count`, `results`, and `next` and `previous` as `{ path, offset, limit }`. The origin is removed so a next link cannot be followed off `LINKDING_URL`.

`linkding_changes_since` does not report deletions. Linkding has no deletion feed.

## Environment

| Variable                 | Default                   | Role                                                                             |
| ------------------------ | ------------------------- | -------------------------------------------------------------------------------- |
| `LINKDING_URL`           | `https://example.invalid` | Linkding origin. No userinfo, query, or hash                                     |
| `LINKDING_API_TOKEN`     | unset                     | Required for an upstream call. At least 8 characters. Never printed              |
| `LINKDING_ALLOW_WRITES`  | off                       | The literal `true` enables writes. Any other value keeps the connector read-only |
| `LINKDING_CONTACT`       | `contact@example.com`     | Contact inside the User-Agent. Must not contain the token                        |
| `LINKDING_PER_MINUTE`    | `30`                      | Local sliding-window cap                                                         |
| `LINKDING_CACHE_TTL_SEC` | `60`                      | TTL for successful reads. `0` disables the cache                                 |
| `LINKDING_TIMEOUT_MS`    | `20000`                   | Upstream timeout                                                                 |
| `MCP_TRANSPORT`          | `stdio`                   | `stdio` or `http`. `--http` forces HTTP                                          |
| `PORT`                   | `3000`                    | HTTP listen port                                                                 |

Invalid values are reported by field name and issue code. The rejected value is not included.

## Safety

A write tool returns a dry-run preview when `confirm` is omitted. The preview is the method, path, query, and body that would be sent.

`confirm` must be the boolean `true`. `false` and the string `"true"` are rejected.

When `confirm` is `true` and `LINKDING_ALLOW_WRITES` is not `true`, the tool still returns the preview, sets `blocked` to true, and does not call Linkding.

Creating a bookmark silently updates an existing bookmark with the same URL. Linkding may change that later. Check the URL first with `linkding_check_bookmark_url` when you need to know.

Linkding merges auto-tagging rules into `tag_names` on every bookmark update, including when the request omits `tag_names`. Creating a tag returns the existing tag when the name is already there.

The token is removed from tool results, error text, and logs, including its URL-encoded form. It is refused in the query string, the base URL, the User-Agent, and a JSON request body.

## Limits

- A cache hit does not spend the local rate limit. The cache is dropped when the process exits, and a successful write clears it.
- When the local window is full, the tool returns `isError` with a `[rate-limited]` message. Cached results are still served.
- HTTP 401 and 403 are `[unauthorized]`. HTTP 404 is `[not-found]`. HTTP 400 and 422 are `[invalid-input]`. HTTP 429 is `[rate-limited]`. Timeouts are `[timeout]`. Other upstream failures are `[upstream-unavailable]`.
- Response bodies larger than 1,000,000 characters are rejected.
- Asset downloads include text only when the content type is textual and the body is at most 32,000 bytes. Otherwise the tool returns content type, length, and filename.
- Uploads read a local file up to 8 MB.
- Requests send `linkding-mcp/0.1.0 (<LINKDING_CONTACT>)`.

TypeScript 6 is intentional. `typescript-eslint` strict type-aware rules need the JavaScript compiler API, which TypeScript 7 does not ship.

## Running the tests

The tests use mocked upstream responses. They need no API key and make no network calls to Linkding.

```bash
npm ci
npm test        # unit and tool tests (vitest)
npm run ci      # typecheck, lint, tests, and build
```

At the time of this commit, `npm test` reports 41 passing tests.

`node scripts/live-check.mjs` (after `npm run build`) runs the tools against a real instance set in `LINKDING_URL` and `LINKDING_API_TOKEN`. It creates and deletes test bookmarks, so use a test instance.

## Author

Issah Abubakari ([@si-essence](https://github.com/si-essence)).

This connector is also listed on [Bot Essentials](https://bot-essentials.netlify.app).

## Licence

MIT. See [LICENSE](LICENSE).
