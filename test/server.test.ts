import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { CONNECTOR_NAME } from "../src/constants.js";

describe("package", () => {
  it("keeps the package name aligned with package.json", () => {
    const pkg = z
      .object({ name: z.string() })
      .parse(JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")));
    expect(pkg.name).toBe(CONNECTOR_NAME);
    expect(pkg.name).toBe("linkding-mcp");
  });
});
