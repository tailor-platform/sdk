import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "pathe";
import { describe, expect, it } from "vitest";

const cliRoot = dirname(fileURLToPath(import.meta.url));

describe("CLI directory structure", () => {
  it("is organized into commands/services/shared", () => {
    expect(existsSync(join(cliRoot, "commands"))).toBe(true);
    expect(existsSync(join(cliRoot, "services"))).toBe(true);
    expect(existsSync(join(cliRoot, "shared"))).toBe(true);
    expect(existsSync(join(cliRoot, "utils"))).toBe(false);
  });
});
