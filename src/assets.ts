import { readFile, stat } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";
import { z } from "zod";
import { ConnectorError } from "./errors.js";
import { confirmField, definedQuery, idField, limitField, offsetField } from "./fields.js";
import { toPage } from "./page.js";
import type { Runtime } from "./runtime.js";
import { assetPageSchema, assetSchema } from "./schemas.js";
import { withWrite, type WritePlan } from "./write-gate.js";
import { fixedError } from "./zod-messages.js";

const MAX_UPLOAD_BYTES = 8_000_000;
const pathError = fixedError("file_path must be a local file path");

export const listAssetsInput = z.object({
  bookmark_id: idField.describe("Bookmark id."),
  limit: limitField,
  offset: offsetField,
});

export const assetIdInput = z.object({
  bookmark_id: idField.describe("Bookmark id."),
  asset_id: idField.describe("Asset id."),
});

export const deleteAssetInput = assetIdInput.extend({
  confirm: confirmField,
});

export const uploadAssetInput = z.object({
  bookmark_id: idField.describe("Bookmark id."),
  file_path: z
    .string()
    .trim()
    .min(1, { error: pathError })
    .max(4096, { error: pathError })
    .describe("Local file to upload. The request is multipart with one part named file."),
  confirm: confirmField,
});

interface LocalFile {
  resolved: string;
  filename: string;
  bytes: number;
  contentType: string;
}

function contentTypeFor(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case ".txt":
    case ".md":
    case ".csv":
      return "text/plain";
    case ".html":
    case ".htm":
      return "text/html";
    case ".json":
      return "application/json";
    case ".pdf":
      return "application/pdf";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    default:
      return "application/octet-stream";
  }
}

function rejectSecretFilename(filename: string, secrets: readonly string[]): void {
  for (const secret of secrets) {
    if (secret.length >= 8 && filename.includes(secret)) {
      throw new ConnectorError("config", "Refusing to place a secret in the upload filename.");
    }
  }
}

async function describeFile(filePath: string, secrets: readonly string[]): Promise<LocalFile> {
  if (filePath.includes("\0")) {
    throw new ConnectorError("invalid_input", "file_path is not a readable file.");
  }
  const resolved = resolve(filePath);
  let info: { isFile: () => boolean; size: number };
  try {
    info = await stat(resolved);
  } catch {
    throw new ConnectorError("invalid_input", "file_path is not a readable file.");
  }
  if (!info.isFile()) {
    throw new ConnectorError("invalid_input", "file_path is not a readable file.");
  }
  if (info.size > MAX_UPLOAD_BYTES) {
    throw new ConnectorError("invalid_input", "file_path is larger than 8 MB.");
  }
  const filename = basename(resolved);
  if (filename.length === 0 || filename === "." || filename === "..") {
    throw new ConnectorError("invalid_input", "file_path is not a readable file.");
  }
  rejectSecretFilename(filename, secrets);
  return { resolved, filename, bytes: info.size, contentType: contentTypeFor(filename) };
}

export async function listAssets(
  runtime: Runtime,
  args: z.output<typeof listAssetsInput>,
): Promise<Record<string, unknown>> {
  const page = await runtime.client.getJson(
    {
      path: `api/bookmarks/${args.bookmark_id}/assets/`,
      query: definedQuery({ limit: args.limit, offset: args.offset }),
      ttlSec: runtime.cacheTtlSec,
    },
    assetPageSchema,
  );
  return toPage(page, runtime.secrets);
}

export async function getAsset(
  runtime: Runtime,
  args: z.output<typeof assetIdInput>,
): Promise<Record<string, unknown>> {
  const asset = await runtime.client.getJson(
    {
      path: `api/bookmarks/${args.bookmark_id}/assets/${args.asset_id}/`,
      query: undefined,
      ttlSec: runtime.cacheTtlSec,
    },
    assetSchema,
  );
  return { asset };
}

export async function downloadAsset(
  runtime: Runtime,
  args: z.output<typeof assetIdInput>,
): Promise<Record<string, unknown>> {
  const file = await runtime.client.download({
    path: `api/bookmarks/${args.bookmark_id}/assets/${args.asset_id}/download/`,
  });
  return {
    bookmark_id: args.bookmark_id,
    asset_id: args.asset_id,
    content_type: file.contentType,
    content_length: file.contentLength,
    filename: file.filename,
    included_text: file.includedText,
    omitted_reason: file.omittedReason,
  };
}

export async function uploadAsset(
  runtime: Runtime,
  args: z.output<typeof uploadAssetInput>,
): Promise<Record<string, unknown>> {
  const file = await describeFile(args.file_path, runtime.secrets);
  const plan: WritePlan = {
    method: "POST",
    path: `api/bookmarks/${args.bookmark_id}/assets/upload/`,
    query: undefined,
    body: { file: file.filename, bytes: file.bytes, content_type: file.contentType },
    summary: `Upload ${file.filename} (${file.bytes} bytes) to bookmark ${args.bookmark_id} as multipart field file.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const bytes = await readFile(file.resolved);
    const form = new FormData();
    form.append("file", new Blob([bytes], { type: file.contentType }), file.filename);
    const asset = await runtime.client.postForm(
      { path: plan.path, query: undefined, form },
      assetSchema,
    );
    return { asset };
  });
}

export async function deleteAsset(
  runtime: Runtime,
  args: z.output<typeof deleteAssetInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "DELETE",
    path: `api/bookmarks/${args.bookmark_id}/assets/${args.asset_id}/`,
    query: undefined,
    body: undefined,
    summary: `Delete asset ${args.asset_id} on bookmark ${args.bookmark_id}.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const result = await runtime.client.delete({ path: plan.path, query: undefined });
    return {
      bookmark_id: args.bookmark_id,
      asset_id: args.asset_id,
      deleted: true,
      status: result.status,
    };
  });
}
