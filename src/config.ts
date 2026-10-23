import { z } from "zod";
import { brandBaseUrl, brandSecret, type BaseUrl, type Secret } from "./brand.js";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "./constants.js";
import { ConnectorError } from "./errors.js";
import { fixedError } from "./zod-messages.js";

const invalid = fixedError("invalid");

const EnvSchema = z.object({
  LINKDING_API_TOKEN: z
    .string({ error: invalid })
    .trim()
    .min(8, { error: invalid })
    .max(512, { error: invalid })
    .optional(),
  LINKDING_URL: z.url({ error: invalid }).optional(),
  LINKDING_ALLOW_WRITES: z.string({ error: invalid }).optional(),
  LINKDING_PER_MINUTE: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  LINKDING_TIMEOUT_MS: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  LINKDING_CONTACT: z
    .string({ error: invalid })
    .trim()
    .min(1, { error: invalid })
    .max(120, { error: invalid })
    .optional(),
  MCP_TRANSPORT: z.enum(["stdio", "http"], { error: invalid }).optional(),
  PORT: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
  LINKDING_CACHE_TTL_SEC: z
    .string({ error: invalid })
    .regex(/^[0-9]+$/, { error: invalid })
    .optional(),
});

export interface Config {
  apiKey: Secret | undefined;
  baseUrl: BaseUrl;
  allowWrites: boolean;
  perMinute: number;
  timeoutMs: number;
  contact: string;
  transport: "stdio" | "http";
  port: number;
  cacheTtlSec: number;
  userAgent: string;
}

function hasControlChar(value: string): boolean {
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function blank(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function read(env: NodeJS.ProcessEnv, name: string): string | undefined {
  return blank(env[name]);
}

function issueSummary(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path =
        issue.path.length === 0 ? "(root)" : issue.path.map((part) => String(part)).join(".");
      return `${path} (${issue.code})`;
    })
    .join("; ");
}

function boundedInt(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
  field: string,
): number {
  if (raw === undefined) return fallback;
  const parsed = z.number().int().min(min).max(max).safeParse(Number(raw));
  if (!parsed.success) {
    throw new ConnectorError("config", `Invalid environment: ${field} (out_of_range).`);
  }
  return parsed.data;
}

function userAgentFor(contact: string): string {
  const clean = contact
    .replace(/[\r\n]+/g, " ")
    .trim()
    .slice(0, 120);
  return `${CONNECTOR_NAME}/${CONNECTOR_VERSION} (${clean.length > 0 ? clean : "contact@example.com"})`;
}

function normalizeBaseUrl(value: string): BaseUrl {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new ConnectorError("config", "Invalid environment: LINKDING_URL (invalid_url).");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new ConnectorError("config", "Invalid environment: LINKDING_URL (invalid_url).");
  }
  if (url.username !== "" || url.password !== "") {
    throw new ConnectorError("config", "Invalid environment: LINKDING_URL (userinfo).");
  }
  if (url.search !== "" || url.hash !== "") {
    throw new ConnectorError("config", "Invalid environment: LINKDING_URL (query_or_hash).");
  }
  return brandBaseUrl(value.replace(/\/+$/, ""));
}

export function loadConfig(env: NodeJS.ProcessEnv, argv: readonly string[]): Config {
  const parsed = EnvSchema.safeParse({
    LINKDING_API_TOKEN: read(env, "LINKDING_API_TOKEN"),
    LINKDING_URL: read(env, "LINKDING_URL"),
    LINKDING_ALLOW_WRITES: read(env, "LINKDING_ALLOW_WRITES"),
    LINKDING_PER_MINUTE: read(env, "LINKDING_PER_MINUTE"),
    LINKDING_TIMEOUT_MS: read(env, "LINKDING_TIMEOUT_MS"),
    LINKDING_CONTACT: read(env, "LINKDING_CONTACT"),
    MCP_TRANSPORT: read(env, "MCP_TRANSPORT"),
    PORT: read(env, "PORT"),
    LINKDING_CACHE_TTL_SEC: read(env, "LINKDING_CACHE_TTL_SEC"),
  });
  if (!parsed.success) {
    throw new ConnectorError("config", `Invalid environment: ${issueSummary(parsed.error)}.`);
  }

  const data = parsed.data;
  const apiKey =
    data.LINKDING_API_TOKEN === undefined ? undefined : brandSecret(data.LINKDING_API_TOKEN);
  const baseUrl = normalizeBaseUrl(data.LINKDING_URL ?? "https://example.invalid");
  const contact = data.LINKDING_CONTACT ?? "contact@example.com";
  if (hasControlChar(contact)) {
    throw new ConnectorError(
      "config",
      "Invalid environment: LINKDING_CONTACT (control_character).",
    );
  }
  const userAgent = userAgentFor(contact);
  if (apiKey !== undefined && baseUrl.includes(apiKey)) {
    throw new ConnectorError("config", "Invalid environment: LINKDING_URL (contains_secret).");
  }
  if (apiKey !== undefined && (contact.includes(apiKey) || userAgent.includes(apiKey))) {
    throw new ConnectorError("config", "Invalid environment: LINKDING_CONTACT (contains_secret).");
  }

  const envTransport = data.MCP_TRANSPORT ?? "stdio";
  const transport = argv.includes("--http") ? "http" : envTransport;
  const allowWrites = data.LINKDING_ALLOW_WRITES === "true";

  return {
    apiKey,
    baseUrl,
    allowWrites,
    perMinute: boundedInt(data.LINKDING_PER_MINUTE, 30, 1, 10_000, "LINKDING_PER_MINUTE"),
    timeoutMs: boundedInt(data.LINKDING_TIMEOUT_MS, 20_000, 100, 120_000, "LINKDING_TIMEOUT_MS"),
    contact,
    transport,
    port: boundedInt(data.PORT, 3000, 1, 65_535, "PORT"),
    cacheTtlSec: boundedInt(data.LINKDING_CACHE_TTL_SEC, 60, 0, 86_400, "LINKDING_CACHE_TTL_SEC"),
    userAgent,
  };
}
