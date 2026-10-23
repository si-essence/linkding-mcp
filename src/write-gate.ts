import type { QueryMap } from "./http.js";
import type { Runtime } from "./runtime.js";

export const WRITES_DISABLED = "LINKDING_ALLOW_WRITES is not true. The write was not sent.";

export interface WritePlan {
  readonly method: "POST" | "PUT" | "PATCH" | "DELETE";
  readonly path: string;
  readonly query: QueryMap | undefined;
  readonly body: unknown;
  readonly summary: string;
  readonly warnings: readonly string[];
}

export function previewWrite(
  plan: WritePlan,
  blocked: boolean,
  reason: string | undefined,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    executed: false,
    dry_run: true,
    blocked,
    method: plan.method,
    path: plan.path,
    summary: plan.summary,
    warnings: [...plan.warnings],
  };
  if (reason !== undefined) payload["reason"] = reason;
  if (plan.query !== undefined) payload["query"] = plan.query;
  if (plan.body !== undefined) payload["body"] = plan.body;
  return payload;
}

export function decideWrite(
  allowWrites: boolean,
  confirm: true | undefined,
  plan: WritePlan,
): { kind: "preview"; payload: Record<string, unknown> } | { kind: "execute" } {
  if (confirm !== true) {
    return { kind: "preview", payload: previewWrite(plan, false, undefined) };
  }
  if (!allowWrites) {
    return { kind: "preview", payload: previewWrite(plan, true, WRITES_DISABLED) };
  }
  return { kind: "execute" };
}

export async function withWrite<T>(
  runtime: Runtime,
  confirm: true | undefined,
  plan: WritePlan,
  run: () => Promise<T>,
): Promise<Record<string, unknown>> {
  const decision = decideWrite(runtime.config.allowWrites, confirm, plan);
  if (decision.kind === "preview") return decision.payload;
  const result = await run();
  return {
    executed: true,
    dry_run: false,
    blocked: false,
    warnings: [...plan.warnings],
    result,
  };
}
