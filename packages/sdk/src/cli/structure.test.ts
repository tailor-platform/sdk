import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "pathe";
import { describe, expect, it } from "vitest";

const cliRoot = dirname(fileURLToPath(import.meta.url));

describe("CLI directory structure", () => {
  it("is organized into commands/services/shared with feature colocation", () => {
    expect(existsSync(join(cliRoot, "commands"))).toBe(true);
    expect(existsSync(join(cliRoot, "services"))).toBe(true);
    expect(existsSync(join(cliRoot, "shared"))).toBe(true);
    expect(existsSync(join(cliRoot, "utils"))).toBe(false);
    expect(existsSync(join(cliRoot, "commands", "apply"))).toBe(true);
    expect(existsSync(join(cliRoot, "commands", "generate"))).toBe(true);
    expect(existsSync(join(cliRoot, "services", "apply"))).toBe(false);
    expect(existsSync(join(cliRoot, "services", "generator"))).toBe(false);
    expect(existsSync(join(cliRoot, "services", "application"))).toBe(true);
    expect(existsSync(join(cliRoot, "services", "bundler"))).toBe(true);
  });
});
