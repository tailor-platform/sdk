import { existsSync, statSync } from "node:fs";
import { resolve } from "pathe";
import { describe, expect, it } from "vitest";
import { resolveBundledSkillsDir } from "./install";

describe("resolveBundledSkillsDir", () => {
  it("resolves to the SDK package's skills/ directory", async () => {
    const dir = await resolveBundledSkillsDir();
    expect(dir.endsWith("/skills")).toBe(true);
    expect(existsSync(dir)).toBe(true);
    expect(statSync(dir).isDirectory()).toBe(true);
    expect(existsSync(resolve(dir, "tailor-sdk", "SKILL.md"))).toBe(true);
  });
});
