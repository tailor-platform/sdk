import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const sdkRoot = resolve(import.meta.dirname, "../..");

describe("tsc-level type assertion audit", () => {
  it("passes all type assertions via direct tsc", () => {
    try {
      execSync("pnpm exec tsc --noEmit --project tsconfig.tsc-audit.json", {
        cwd: sdkRoot,
        encoding: "utf-8",
        timeout: 60_000,
      });
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string };
      throw new Error(`tsc failed:\n${e.stdout ?? ""}${e.stderr ?? ""}`);
    }
  }, 60_000);

  it("covers all expectTypeOf assertions from infer.test.ts", () => {
    const testFile = readFileSync(resolve(import.meta.dirname, "infer.test.ts"), "utf-8");
    const auditFile = readFileSync(resolve(import.meta.dirname, "infer.tsc-audit.ts"), "utf-8");

    const testCount = (testFile.match(/expectTypeOf[<(]/g) ?? []).length;
    const auditCount = (auditFile.match(/= Assert</g) ?? []).length;

    expect(auditCount).toBeGreaterThanOrEqual(testCount);
  });
});
