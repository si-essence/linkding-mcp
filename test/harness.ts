import { loadConfig } from "../src/config.js";
import { AUTH_HEADER, authorizationValue } from "../src/http.js";
import { createRuntime, type Runtime } from "../src/runtime.js";

export const TOKEN = "super-secret/key+value=99";
export const BASE = "https://linkding.test";

export function env(extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    LINKDING_URL: BASE,
    LINKDING_API_TOKEN: TOKEN,
    LINKDING_CACHE_TTL_SEC: "0",
    ...extra,
  };
}

export function runtimeFor(
  fetchImpl: typeof fetch,
  extra: NodeJS.ProcessEnv = {},
  now?: () => number,
): Runtime {
  return createRuntime(loadConfig(env(extra), []), {
    fetchImpl,
    ...(now === undefined ? {} : { now }),
  });
}

export function requestUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.toString();
  return input.url;
}

export interface CapturedRequest {
  method: string;
  url: string;
  authorization: string | null;
  body: unknown;
  contentType: string | null;
}

export function capturedFrom(input: RequestInfo | URL, init?: RequestInit): CapturedRequest {
  const headers = new Headers(init?.headers);
  let body: unknown;
  if (init?.body === undefined) body = undefined;
  else if (typeof init.body === "string") {
    try {
      body = JSON.parse(init.body) as unknown;
    } catch {
      body = init.body;
    }
  } else body = init.body;
  return {
    method: init?.method ?? "GET",
    url: requestUrl(input),
    authorization: headers.get(AUTH_HEADER),
    body,
    contentType: headers.get("content-type"),
  };
}

export function jsonFetch(impl: (captured: CapturedRequest) => Response | Promise<Response>): {
  fetchImpl: typeof fetch;
  calls: CapturedRequest[];
} {
  const calls: CapturedRequest[] = [];
  const fetchImpl: typeof fetch = (input, init) => {
    const captured = capturedFrom(input, init);
    calls.push(captured);
    return Promise.resolve(impl(captured));
  };
  return { fetchImpl, calls };
}

export function expectAuth(captured: CapturedRequest): void {
  if (captured.authorization !== authorizationValue(TOKEN)) {
    throw new Error("missing token authorization");
  }
  if (captured.url.includes(TOKEN)) {
    throw new Error("token leaked into the url");
  }
}
