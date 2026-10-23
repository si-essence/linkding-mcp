import { z } from "zod";
import { confirmField, definedQuery, idField, limitField, offsetField, tagName } from "./fields.js";
import { toPage } from "./page.js";
import type { Runtime } from "./runtime.js";
import { tagPageSchema, tagSchema } from "./schemas.js";
import { withWrite, type WritePlan } from "./write-gate.js";

export const TAG_UPSERT_WARNING = "Linkding returns the existing tag when the name already exists.";

export const listTagsInput = z.object({
  limit: limitField,
  offset: offsetField,
});

export const getTagInput = z.object({
  id: idField.describe("Tag id."),
});

export const createTagInput = z.object({
  name: tagName.describe("Tag name. Spaces are stored as hyphens."),
  confirm: confirmField,
});

export const deleteTagInput = z.object({
  id: idField.describe("Tag id."),
  confirm: confirmField,
});

export async function listTags(
  runtime: Runtime,
  args: z.output<typeof listTagsInput>,
): Promise<Record<string, unknown>> {
  const page = await runtime.client.getJson(
    {
      path: "api/tags/",
      query: definedQuery({ limit: args.limit, offset: args.offset }),
      ttlSec: runtime.cacheTtlSec,
    },
    tagPageSchema,
  );
  return toPage(page, runtime.secrets);
}

export async function getTag(
  runtime: Runtime,
  args: z.output<typeof getTagInput>,
): Promise<Record<string, unknown>> {
  const tag = await runtime.client.getJson(
    { path: `api/tags/${args.id}/`, query: undefined, ttlSec: runtime.cacheTtlSec },
    tagSchema,
  );
  return { tag };
}

export async function createTag(
  runtime: Runtime,
  args: z.output<typeof createTagInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "POST",
    path: "api/tags/",
    query: undefined,
    body: { name: args.name },
    summary: "Create a tag with POST /api/tags/.",
    warnings: [TAG_UPSERT_WARNING],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const tag = await runtime.client.postJson(
      { path: plan.path, query: undefined, body: plan.body, ttlSec: 0, invalidate: true },
      tagSchema,
    );
    return { tag };
  });
}

export async function deleteTag(
  runtime: Runtime,
  args: z.output<typeof deleteTagInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "DELETE",
    path: `api/tags/${args.id}/`,
    query: undefined,
    body: undefined,
    summary: `Delete tag ${args.id}.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const result = await runtime.client.delete({ path: plan.path, query: undefined });
    return { tag_id: args.id, deleted: true, status: result.status };
  });
}
