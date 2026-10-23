import { z } from "zod";
import type { Runtime } from "./runtime.js";
import { userProfileSchema } from "./schemas.js";

export const getProfileInput = z.object({});

export async function getProfile(runtime: Runtime): Promise<Record<string, unknown>> {
  const profile = await runtime.client.getJson(
    { path: "api/user/profile/", query: undefined, ttlSec: runtime.cacheTtlSec },
    userProfileSchema,
  );
  return { profile };
}
