import type { ZodType } from "zod";
import type { BaseUrl, Secret } from "./brand.js";
import { TtlCache } from "./cache.js";
import { ConnectorError } from "./errors.js";
import type { Logger } from "./log.js";
import type { RateLimiter } from "./rate-limit.js";
import { redact, redactUnknown, stripUrls } from "./redact.js";

export const AUTH_HEADER = "authorization";
const MAX_BODY = 1_000_000;
const MAX_TEXT_BYTES = 32_000;

export type QueryPrimitive = string | number | boolean;
export type QueryValue = QueryPrimitive | readonly QueryPrimitive[];
export type QueryMap = Readonly<Record<string, QueryValue>>;

export interface JsonGet {
  path: string;
  query: QueryMap | undefined;
  ttlSec: number;
  /**
   * When false, return the parsed body without redaction and do not cache it.
   * Use this only for a value that is written back and never returned to the caller.
   */
  redactResponse?: boolean;
}

export interface JsonWrite {
  path: string;
  query: QueryMap | undefined;
  body: unknown;
  ttlSec: number;
  invalidate: boolean;
}

export interface EmptyWrite {
  path: string;
  query: QueryMap | undefined;
}

export interface FormWrite {
  path: string;
  query: QueryMap | undefined;
  form: FormData;
}

export interface DownloadPayload {
  contentType: string;
  contentLength: number | null;
  filename: string | null;
  includedText: string | null;
  omittedReason: "binary" | "too_large" | null;
}

export function authorizationValue(token: string): string {
  return `Token ${token}`;
}

export interface HttpClientOptions {
  baseUrl: BaseUrl;
  fetchImpl: typeof fetch;
  timeoutMs: number;
  secrets: readonly string[];
  cache: TtlCache;
  limiter: RateLimiter;
  userAgent: string;
  logger: Logger;
  apiKey: Secret | undefined;
  label: string;
}

type Method = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class HttpClient {
  private readonly baseUrl: BaseUrl;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly secrets: readonly string[];
  private readonly cache: TtlCache;
  private readonly limiter: RateLimiter;
  private readonly userAgent: string;
  private readonly logger: Logger;
  private readonly apiKey: Secret | undefined;
  private readonly label: string;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl;
    this.fetchImpl = options.fetchImpl;
    this.timeoutMs = options.timeoutMs;
    this.secrets = options.secrets;
    this.cache = options.cache;
    this.limiter = options.limiter;
    this.userAgent = options.userAgent;
    this.logger = options.logger;
    this.apiKey = options.apiKey;
    this.label = options.label;
  }

  async getJson<T>(request: JsonGet, schema: ZodType<T>): Promise<T> {
    const url = this.buildUrl(request.path, request.query);
    const cacheKey = `GET ${url.origin}${url.pathname}${url.search}`;
    const redactResponse = request.redactResponse !== false;
    if (request.ttlSec > 0 && redactResponse) {
      const cached = this.readCache(cacheKey, schema);
      if (cached !== undefined) return cached;
    }
    const response = await this.dispatch(url, "GET", undefined, false);
    const text = await readLimited(response, this.label);
    if (!response.ok) throw this.httpError(response, text);
    this.rejectHtml(text, response.status);
    const json = parseJsonBody(text, response.status, this.label);
    return this.accept(cacheKey, request.ttlSec, schema, json, redactResponse);
  }

  async postJson<T>(request: JsonWrite, schema: ZodType<T>): Promise<T> {
    return this.sendJson("POST", request, schema);
  }

  async putJson<T>(request: JsonWrite, schema: ZodType<T>): Promise<T> {
    return this.sendJson("PUT", request, schema);
  }

  async patchJson<T>(request: JsonWrite, schema: ZodType<T>): Promise<T> {
    return this.sendJson("PATCH", request, schema);
  }

  async postEmpty(request: EmptyWrite): Promise<{ status: number }> {
    return this.sendEmpty("POST", request);
  }

  async delete(request: EmptyWrite): Promise<{ status: number }> {
    return this.sendEmpty("DELETE", request);
  }

  async postForm<T>(request: FormWrite, schema: ZodType<T>): Promise<T> {
    const url = this.buildUrl(request.path, request.query);
    const response = await this.dispatch(url, "POST", request.form, false);
    const text = await readLimited(response, this.label);
    if (!response.ok) throw this.httpError(response, text);
    this.rejectHtml(text, response.status);
    const json = parseJsonBody(text, response.status, this.label);
    const accepted = this.accept(`POST ${url.pathname}`, 0, schema, json, true);
    this.cache.clear();
    return accepted;
  }

  async download(request: { path: string }): Promise<DownloadPayload> {
    const url = this.buildUrl(request.path, undefined);
    const response = await this.dispatch(url, "GET", undefined, false, "*/*");
    if (!response.ok) {
      const text = await readLimited(response, this.label);
      throw this.httpError(response, text);
    }
    return readDownload(response, this.secrets);
  }

  private async sendJson<T>(method: Method, request: JsonWrite, schema: ZodType<T>): Promise<T> {
    const bodyText = this.serializeBody(request.body);
    const url = this.buildUrl(request.path, request.query);
    const response = await this.dispatch(url, method, bodyText, true);
    const text = await readLimited(response, this.label);
    if (!response.ok) throw this.httpError(response, text);
    this.rejectHtml(text, response.status);
    const json = parseJsonBody(text, response.status, this.label);
    const accepted = this.accept(`${method} ${url.pathname}`, request.ttlSec, schema, json, true);
    if (request.invalidate) this.cache.clear();
    return accepted;
  }

  private async sendEmpty(method: Method, request: EmptyWrite): Promise<{ status: number }> {
    const url = this.buildUrl(request.path, request.query);
    const response = await this.dispatch(url, method, undefined, false);
    const text = await readLimited(response, this.label);
    if (!response.ok) throw this.httpError(response, text);
    this.cache.clear();
    return { status: response.status };
  }

  private serializeBody(body: unknown): string | undefined {
    if (body === undefined) return undefined;
    let text: string;
    try {
      text = JSON.stringify(body);
    } catch {
      throw new ConnectorError("invalid_input", "Request body could not be serialized as JSON.");
    }
    if (text.length > MAX_BODY) {
      throw new ConnectorError("invalid_input", "Request body was too large.");
    }
    this.assertNoSecret(text, "Refusing to place a secret in the request.");
    return text;
  }

  private readCache<T>(cacheKey: string, schema: ZodType<T>): T | undefined {
    const cached = this.cache.get(cacheKey);
    if (cached === undefined) return undefined;
    const parsed = schema.safeParse(cached);
    if (parsed.success) return parsed.data;
    this.cache.delete(cacheKey);
    return undefined;
  }

  private accept<T>(
    cacheKey: string,
    ttlSec: number,
    schema: ZodType<T>,
    json: unknown,
    redactResponse: boolean,
  ): T {
    const parsed = schema.safeParse(json);
    if (!parsed.success) {
      throw new ConnectorError(
        "upstream_unavailable",
        `${this.label} response did not match the expected shape.`,
      );
    }
    if (!redactResponse) return parsed.data;
    const safe = schema.safeParse(redactUnknown(parsed.data, this.secrets));
    if (!safe.success) {
      throw new ConnectorError(
        "upstream_unavailable",
        `${this.label} response could not be returned safely.`,
      );
    }
    if (ttlSec > 0) this.cache.set(cacheKey, safe.data, ttlSec);
    return safe.data;
  }

  private rejectHtml(text: string, status: number): void {
    if (/<!doctype html|<html[\s>]/i.test(text)) {
      throw new ConnectorError(
        "upstream_unavailable",
        `${this.label} HTTP ${status}: the service returned an error page instead of JSON.`,
      );
    }
  }

  private buildUrl(path: string, query: QueryMap | undefined): URL {
    if (
      path.length === 0 ||
      path.startsWith("/") ||
      path.includes("?") ||
      path.includes("#") ||
      path.includes("\\") ||
      path.includes("..")
    ) {
      throw new ConnectorError("invalid_input", "Request path must be a relative path.");
    }
    this.assertNoSecret(path, "Refusing to place a secret in the request URL.");
    const base = new URL(`${this.baseUrl}/`);
    const url = new URL(path, base);
    if (url.origin !== base.origin) {
      throw new ConnectorError(
        "invalid_input",
        "Request path must stay on the configured base URL.",
      );
    }
    this.assertNoSecret(
      `${url.pathname}${url.search}`,
      "Refusing to place a secret in the request URL.",
    );
    if (query !== undefined) {
      for (const key of Object.keys(query).sort()) {
        const value = query[key];
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) {
            const text = String(item);
            this.assertNoSecret(text, "Refusing to place a secret in the request URL.");
            url.searchParams.append(key, text);
          }
        } else {
          const text = String(value);
          this.assertNoSecret(text, "Refusing to place a secret in the request URL.");
          url.searchParams.set(key, text);
        }
      }
    }
    return url;
  }

  private assertNoSecret(value: string, message: string): void {
    for (const secret of this.secrets) {
      if (
        secret.length >= 8 &&
        (value.includes(secret) || value.includes(encodeURIComponent(secret)))
      ) {
        this.logger.error(message);
        throw new ConnectorError("config", message);
      }
    }
  }

  private requireKey(): void {
    if (this.apiKey === undefined) {
      throw new ConnectorError(
        "config",
        "LINKDING_API_TOKEN is not set. Add it to the environment before calling the upstream API.",
      );
    }
  }

  private async dispatch(
    url: URL,
    method: Method,
    body: BodyInit | undefined,
    jsonBody: boolean,
    accept = "application/json",
  ): Promise<Response> {
    this.requireKey();
    this.limiter.acquire();
    const headers = new Headers();
    headers.set("accept", accept);
    headers.set("user-agent", this.userAgent);
    if (this.apiKey !== undefined) headers.set(AUTH_HEADER, authorizationValue(this.apiKey));
    if (jsonBody) headers.set("content-type", "application/json");
    try {
      return await this.fetchImpl(url, {
        method,
        headers,
        signal: AbortSignal.timeout(this.timeoutMs),
        ...(body === undefined ? {} : { body }),
      });
    } catch (error) {
      if (error instanceof ConnectorError) throw error;
      const name = error instanceof Error ? error.name : "";
      if (name === "TimeoutError" || name === "AbortError") {
        const seconds = Math.max(1, Math.round(this.timeoutMs / 1000));
        throw new ConnectorError("timeout", `${this.label} request timed out after ${seconds}s.`);
      }
      const raw = error instanceof Error ? error.message : "network error";
      const safe = publicSnippet(raw, this.secrets);
      this.logger.error(`${this.label} request failed: ${safe}`);
      throw new ConnectorError("upstream_unavailable", `${this.label} request failed: ${safe}`);
    }
  }

  private httpError(response: Response, text: string): ConnectorError {
    const snippet = publicSnippet(text, this.secrets);
    const detail = snippet.length > 0 ? `: ${snippet}` : "";
    const status = response.status;
    if (status === 401 || status === 403) {
      return new ConnectorError("unauthorized", `${this.label} HTTP ${status}${detail}`);
    }
    if (status === 404) {
      return new ConnectorError("not_found", `${this.label} HTTP 404${detail}`);
    }
    if (status === 400 || status === 422) {
      return new ConnectorError("invalid_input", `${this.label} HTTP ${status}${detail}`);
    }
    if (status === 429) {
      return new ConnectorError(
        "rate_limited",
        `${this.label} HTTP 429${detail}`,
        retryAfterSeconds(response),
      );
    }
    if (status === 408 || status === 504) {
      return new ConnectorError("timeout", `${this.label} HTTP ${status}${detail}`);
    }
    this.logger.error(`${this.label} HTTP ${status}${detail}`);
    return new ConnectorError("upstream_unavailable", `${this.label} HTTP ${status}${detail}`);
  }
}

function publicSnippet(text: string, secrets: readonly string[]): string {
  return stripUrls(redact(text, secrets)).replace(/\s+/g, " ").trim().slice(0, 180);
}

function parseJsonBody(text: string, status: number, label: string): unknown {
  if (text.trim().length === 0) {
    throw new ConnectorError(
      "upstream_unavailable",
      `${label} returned an empty body (HTTP ${status}).`,
    );
  }
  try {
    return parseJson(text);
  } catch {
    throw new ConnectorError(
      "upstream_unavailable",
      `${label} returned non-JSON (HTTP ${status}).`,
    );
  }
}

function parseJson(text: string): unknown {
  return JSON.parse(text) as unknown;
}

async function readLimited(response: Response, label: string): Promise<string> {
  const declared = response.headers.get("content-length");
  if (declared !== null && /^[0-9]+$/.test(declared) && Number(declared) > MAX_BODY) {
    await response.body?.cancel().catch(() => undefined);
    throw new ConnectorError("upstream_unavailable", `${label} response was too large to parse.`);
  }
  let text = "";
  try {
    text = await response.text();
  } catch {
    throw new ConnectorError("upstream_unavailable", `${label} response could not be read.`);
  }
  if (text.length > MAX_BODY) {
    throw new ConnectorError("upstream_unavailable", `${label} response was too large to parse.`);
  }
  return text;
}

function contentLengthOf(header: string | null): number | null {
  if (header === null || !/^[0-9]+$/.test(header)) return null;
  return Number(header);
}

function isTextual(contentType: string): boolean {
  const base = contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  return (
    base.startsWith("text/") ||
    base === "application/json" ||
    base === "application/xml" ||
    base.endsWith("+json") ||
    base.endsWith("+xml")
  );
}

function filenameFrom(header: string | null, secrets: readonly string[]): string | null {
  if (header === null) return null;
  const starred = /filename\*=(?:UTF-8''|utf-8'')([^;]+)/i.exec(header);
  const plain = /filename="([^"]+)"/i.exec(header) ?? /filename=([^;]+)/i.exec(header);
  const raw = starred?.[1] ?? plain?.[1];
  if (raw === undefined) return null;
  let name = raw.trim();
  try {
    name = decodeURIComponent(name);
  } catch {
    name = raw.trim();
  }
  const cleaned = redact(name, secrets).slice(0, 200);
  return cleaned.length === 0 ? null : cleaned;
}

async function readDownload(
  response: Response,
  secrets: readonly string[],
): Promise<DownloadPayload> {
  const contentType = response.headers.get("content-type") ?? "";
  const declared = contentLengthOf(response.headers.get("content-length"));
  const filename = filenameFrom(response.headers.get("content-disposition"), secrets);
  const textual = isTextual(contentType);
  if (!textual || (declared !== null && declared > MAX_TEXT_BYTES)) {
    await response.body?.cancel().catch(() => undefined);
    return {
      contentType,
      contentLength: declared,
      filename,
      includedText: null,
      omittedReason: textual ? "too_large" : "binary",
    };
  }
  if (response.body === null) {
    return {
      contentType,
      contentLength: 0,
      filename,
      includedText: "",
      omittedReason: null,
    };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const step = await reader.read();
    if (step.done) break;
    received += step.value.byteLength;
    if (received > MAX_TEXT_BYTES) {
      await reader.cancel().catch(() => undefined);
      return {
        contentType,
        contentLength: declared ?? received,
        filename,
        includedText: null,
        omittedReason: "too_large",
      };
    }
    chunks.push(step.value);
  }
  return {
    contentType,
    contentLength: declared ?? received,
    filename,
    includedText: Buffer.concat(chunks).toString("utf8"),
    omittedReason: null,
  };
}

function retryAfterSeconds(response: Response): number | null {
  const raw = response.headers.get("retry-after");
  if (raw === null) return null;
  if (/^[0-9]+$/.test(raw)) {
    const seconds = Number(raw);
    return seconds > 0 ? seconds : null;
  }
  const when = Date.parse(raw);
  if (Number.isNaN(when)) return null;
  return Math.max(1, Math.ceil((when - Date.now()) / 1000));
}
