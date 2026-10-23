import { z } from "zod";
import {
  confirmField,
  definedBody,
  definedQuery,
  idField,
  limitField,
  offsetField,
  optionalText,
} from "./fields.js";
import { toPage } from "./page.js";
import type { Runtime } from "./runtime.js";
import { bundlePageSchema, bundleSchema } from "./schemas.js";
import { withWrite, type WritePlan } from "./write-gate.js";
import { fixedError } from "./zod-messages.js";

const filterState = z.enum(["off", "yes", "no"]);
const orderField = z.number().int().min(0).max(100_000);

const bundleFields = {
  name: optionalText(256, "name"),
  search: optionalText(256, "search").describe("Search phrase saved on the bundle."),
  any_tags: optionalText(1024, "any_tags").describe("Space-separated tags. Any one may match."),
  all_tags: optionalText(1024, "all_tags").describe("Space-separated tags. All must match."),
  excluded_tags: optionalText(1024, "excluded_tags").describe("Space-separated tags to exclude."),
  filter_unread: filterState.optional().describe("off, yes, or no."),
  filter_shared: filterState.optional().describe("off, yes, or no."),
  order: orderField
    .optional()
    .describe("Display order. Linkding assigns the next order when omitted."),
};

const bundleUpdateError = fixedError(
  "Provide at least one bundle field. PUT (replace true) also requires name.",
);

function bundleBody(args: {
  name?: string | undefined;
  search?: string | undefined;
  any_tags?: string | undefined;
  all_tags?: string | undefined;
  excluded_tags?: string | undefined;
  filter_unread?: "off" | "yes" | "no" | undefined;
  filter_shared?: "off" | "yes" | "no" | undefined;
  order?: number | undefined;
}): Record<string, unknown> | undefined {
  return definedBody({
    name: args.name,
    search: args.search,
    any_tags: args.any_tags,
    all_tags: args.all_tags,
    excluded_tags: args.excluded_tags,
    filter_unread: args.filter_unread,
    filter_shared: args.filter_shared,
    order: args.order,
  });
}

export const listBundlesInput = z.object({
  limit: limitField,
  offset: offsetField,
});

export const getBundleInput = z.object({
  id: idField.describe("Bundle id."),
});

export const createBundleInput = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: fixedError("name must be 1 to 256 characters") })
    .max(256, { error: fixedError("name must be 1 to 256 characters") })
    .describe("Bundle name."),
  search: bundleFields.search,
  any_tags: bundleFields.any_tags,
  all_tags: bundleFields.all_tags,
  excluded_tags: bundleFields.excluded_tags,
  filter_unread: bundleFields.filter_unread,
  filter_shared: bundleFields.filter_shared,
  order: bundleFields.order,
  confirm: confirmField,
});

export const updateBundleInput = z
  .object({
    id: idField.describe("Bundle id."),
    ...bundleFields,
    replace: z
      .boolean()
      .optional()
      .describe("When true, send PUT. name is required. Omitted fields stay unchanged."),
    confirm: confirmField,
  })
  .check(
    z.refine(
      (value) => {
        const changed = bundleBody(value) !== undefined;
        if (!changed) return false;
        if (value.replace === true && (value.name === undefined || value.name.length === 0)) {
          return false;
        }
        return true;
      },
      { error: bundleUpdateError },
    ),
  );

export const deleteBundleInput = z.object({
  id: idField.describe("Bundle id."),
  confirm: confirmField,
});

export async function listBundles(
  runtime: Runtime,
  args: z.output<typeof listBundlesInput>,
): Promise<Record<string, unknown>> {
  const page = await runtime.client.getJson(
    {
      path: "api/bundles/",
      query: definedQuery({ limit: args.limit, offset: args.offset }),
      ttlSec: runtime.cacheTtlSec,
    },
    bundlePageSchema,
  );
  return toPage(page, runtime.secrets);
}

export async function getBundle(
  runtime: Runtime,
  args: z.output<typeof getBundleInput>,
): Promise<Record<string, unknown>> {
  const bundle = await runtime.client.getJson(
    { path: `api/bundles/${args.id}/`, query: undefined, ttlSec: runtime.cacheTtlSec },
    bundleSchema,
  );
  return { bundle };
}

export async function createBundle(
  runtime: Runtime,
  args: z.output<typeof createBundleInput>,
): Promise<Record<string, unknown>> {
  const body = bundleBody(args) ?? { name: args.name };
  if (body["name"] === undefined) body["name"] = args.name;
  const plan: WritePlan = {
    method: "POST",
    path: "api/bundles/",
    query: undefined,
    body,
    summary: "Create a bundle with POST /api/bundles/.",
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const bundle = await runtime.client.postJson(
      { path: plan.path, query: undefined, body, ttlSec: 0, invalidate: true },
      bundleSchema,
    );
    return { bundle };
  });
}

export async function updateBundle(
  runtime: Runtime,
  args: z.output<typeof updateBundleInput>,
): Promise<Record<string, unknown>> {
  const method = args.replace === true ? "PUT" : "PATCH";
  const body = bundleBody(args) ?? {};
  const plan: WritePlan = {
    method,
    path: `api/bundles/${args.id}/`,
    query: undefined,
    body,
    summary: `Update bundle ${args.id} with ${method} /api/bundles/${args.id}/.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const request = { path: plan.path, query: undefined, body, ttlSec: 0, invalidate: true };
    const bundle =
      method === "PUT"
        ? await runtime.client.putJson(request, bundleSchema)
        : await runtime.client.patchJson(request, bundleSchema);
    return { bundle };
  });
}

export async function deleteBundle(
  runtime: Runtime,
  args: z.output<typeof deleteBundleInput>,
): Promise<Record<string, unknown>> {
  const plan: WritePlan = {
    method: "DELETE",
    path: `api/bundles/${args.id}/`,
    query: undefined,
    body: undefined,
    summary: `Delete bundle ${args.id}.`,
    warnings: [],
  };
  return withWrite(runtime, args.confirm, plan, async () => {
    const result = await runtime.client.delete({ path: plan.path, query: undefined });
    return { bundle_id: args.id, deleted: true, status: result.status };
  });
}
