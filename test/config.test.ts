import { describe, expect, it } from "vitest";
import { CONNECTOR_NAME, CONNECTOR_VERSION } from "../src/constants.js";
import { loadConfig } from "../src/config.js";
import { ConnectorError } from "../src/errors.js";

const KEY = "super-secret/key+value=99";

function messageOf(error: unknown): string {
  expect(error).toBeInstanceOf(ConnectorError);
  if (!(error instanceof ConnectorError)) throw error;
  return error.message;
}

describe("loadConfig", () => {
  it("applies defaults", () => {
    const config = loadConfig({}, []);
    expect(config.apiKey).toBeUndefined();
    expect(config.baseUrl).toBe("https://example.invalid");
    expect(config.allowWrites).toBe(false);
    expect(config.perMinute).toBe(30);
    expect(config.timeoutMs).toBe(20_000);
    expect(config.contact).toBe("contact@example.com");
    expect(config.transport).toBe("stdio");
    expect(config.port).toBe(3000);
    expect(config.cacheTtlSec).toBe(60);
    expect(config.userAgent).toBe(`${CONNECTOR_NAME}/${CONNECTOR_VERSION} (contact@example.com)`);
  });

  it("enables writes only for the literal true", () => {
    expect(loadConfig({ LINKDING_ALLOW_WRITES: "true" }, []).allowWrites).toBe(true);
    expect(loadConfig({ LINKDING_ALLOW_WRITES: "TRUE" }, []).allowWrites).toBe(false);
    expect(loadConfig({ LINKDING_ALLOW_WRITES: "1" }, []).allowWrites).toBe(false);
  });

  it("lets --http override the transport", () => {
    expect(loadConfig({ MCP_TRANSPORT: "stdio" }, ["node", "app", "--http"]).transport).toBe(
      "http",
    );
    expect(loadConfig({ MCP_TRANSPORT: "http" }, []).transport).toBe("http");
  });

  it("reports invalid fields without the rejected value or the api key", () => {
    let caught: unknown;
    try {
      loadConfig({ LINKDING_API_TOKEN: KEY, PORT: "nope", MCP_TRANSPORT: "sse" }, []);
    } catch (error) {
      caught = error;
    }
    const message = messageOf(caught);
    expect(message).toContain("PORT");
    expect(message).toContain("MCP_TRANSPORT");
    expect(message).not.toContain(KEY);
    expect(message).not.toContain("nope");
    expect(message).not.toContain("sse");
  });

  it("rejects a short api key without echoing it", () => {
    let caught: unknown;
    try {
      loadConfig({ LINKDING_API_TOKEN: "short" }, []);
    } catch (error) {
      caught = error;
    }
    const message = messageOf(caught);
    expect(message).toContain("LINKDING_API_TOKEN");
    expect(message).not.toContain("short");
  });

  it("rejects a base url or contact that contains the api key", () => {
    const inUrl = messageOf(
      catchError(() =>
        loadConfig({ LINKDING_API_TOKEN: KEY, LINKDING_URL: `https://example.invalid/${KEY}` }, []),
      ),
    );
    expect(inUrl).toContain("contains_secret");
    expect(inUrl).not.toContain(KEY);

    const inContact = messageOf(
      catchError(() => loadConfig({ LINKDING_API_TOKEN: KEY, LINKDING_CONTACT: KEY }, [])),
    );
    expect(inContact).toContain("LINKDING_CONTACT");
    expect(inContact).not.toContain(KEY);
  });

  it("rejects userinfo and query strings on the base url", () => {
    const userinfo = messageOf(
      catchError(() => loadConfig({ LINKDING_URL: "https://user:pass@example.invalid" }, [])),
    );
    expect(userinfo).toContain("userinfo");
    expect(userinfo).not.toContain("pass");

    const query = messageOf(
      catchError(() =>
        loadConfig({ LINKDING_URL: `https://example.invalid/v1?api_key=${KEY}` }, []),
      ),
    );
    expect(query).toContain("LINKDING_URL");
    expect(query).not.toContain(KEY);
  });
});

function catchError(fn: () => unknown): unknown {
  try {
    fn();
    return undefined;
  } catch (error) {
    return error;
  }
}
