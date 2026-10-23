export const CONNECTOR_ERROR_CODES = [
  "config",
  "unauthorized",
  "not_found",
  "invalid_input",
  "upstream_unavailable",
  "timeout",
  "rate_limited",
] as const;

export type ConnectorErrorCode = (typeof CONNECTOR_ERROR_CODES)[number];

export class ConnectorError extends Error {
  readonly code: ConnectorErrorCode;
  readonly retryAfterSeconds: number | null;

  constructor(code: ConnectorErrorCode, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = "ConnectorError";
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export function errorPrefix(code: ConnectorErrorCode): string {
  switch (code) {
    case "config":
      return "[config] ";
    case "unauthorized":
      return "[unauthorized] ";
    case "not_found":
      return "[not-found] ";
    case "invalid_input":
      return "[invalid-input] ";
    case "upstream_unavailable":
      return "[upstream-unavailable] ";
    case "timeout":
      return "[timeout] ";
    case "rate_limited":
      return "[rate-limited] ";
    default: {
      const neverCode: never = code;
      return neverCode;
    }
  }
}
