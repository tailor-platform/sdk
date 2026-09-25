import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { aroundAll, aroundEach, describe, expect, test, vi } from "vitest";
import type { ensureConfigIdForDeploy as EnsureConfigIdForDeploy } from "./config-id-injector";

const configWithId = `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  id: "d077ac82-179a-4d76-bb22-46c346a67ce1",
  name: "my-app",
});
`;

const configWithoutId = `import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  name: "my-app",
});
`;

describe("ensureConfigIdForDeploy", () => {
  let tempDir: string;

  aroundEach(async (runTest) => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "config-id-ci-"));
    await runTest();
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    vi.unstubAllEnvs();
  });

  async function writeConfig(source: string): Promise<string> {
    const filePath = path.join(tempDir, "tailor.config.ts");
    await fs.promises.writeFile(filePath, source, "utf-8");
    return filePath;
  }

  describe("in CI", () => {
    let ensureConfigIdForDeploy: typeof EnsureConfigIdForDeploy;

    aroundAll(async (runSuite) => {
      vi.resetModules();
      vi.doMock("std-env", () => ({ isCI: true }));
      ({ ensureConfigIdForDeploy } = await import("./config-id-injector"));
      await runSuite();
      vi.doUnmock("std-env");
      vi.resetModules();
    });

    test("missing id: throws with remediation guidance", async () => {
      const filePath = await writeConfig(configWithoutId);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
      ).rejects.toThrow(/missing an 'id'|deploy/);
      // Must not have injected anything in CI.
      expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithoutId);
    });

    test("existing id: passes without mutating the file", async () => {
      const filePath = await writeConfig(configWithId);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
      ).resolves.toBeUndefined();
      expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithId);
    });

    test("wrapper config (no inline defineConfig): skips the check", async () => {
      const filePath = await writeConfig(`export { default } from "./base.config";
`);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
      ).resolves.toBeUndefined();
    });

    test("multiple defineConfig calls: throws instead of bypassing the check", async () => {
      const filePath = await writeConfig(`import { defineConfig } from "@tailor-platform/sdk";
const a = defineConfig({ name: "a" });
export default defineConfig({ name: "b" });
`);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
      ).rejects.toThrow(/Only one is supported/);
    });

    test("non-UUID id: throws", async () => {
      const filePath = await writeConfig(`import { defineConfig } from "@tailor-platform/sdk";
export default defineConfig({
  id: "not-a-uuid",
  name: "my-app",
});
`);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
      ).rejects.toThrow(/must be a UUID/);
    });

    test("missing id + TAILOR_CI_ALLOW_ID_INJECTION: injects an id", async () => {
      vi.stubEnv("TAILOR_CI_ALLOW_ID_INJECTION", "true");
      const filePath = await writeConfig(configWithoutId);
      await ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false });
      expect(await fs.promises.readFile(filePath, "utf-8")).toMatch(/id:\s*"/);
    });

    test("dry-run + missing id: throws so plan fails at PR time", async () => {
      const filePath = await writeConfig(configWithoutId);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: true, buildOnly: false }),
      ).rejects.toThrow(/missing an 'id'/);
      // Read-only: nothing is injected on a dry-run.
      expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithoutId);
    });

    test("dry-run + existing id: passes without mutating the file", async () => {
      const filePath = await writeConfig(configWithId);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: true, buildOnly: false }),
      ).resolves.toBeUndefined();
      expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithId);
    });

    test("build-only: skips the check entirely", async () => {
      const filePath = await writeConfig(configWithoutId);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: true }),
      ).resolves.toBeUndefined();
    });
  });

  describe("local", () => {
    let ensureConfigIdForDeploy: typeof EnsureConfigIdForDeploy;

    aroundAll(async (runSuite) => {
      vi.resetModules();
      vi.doMock("std-env", () => ({ isCI: false }));
      ({ ensureConfigIdForDeploy } = await import("./config-id-injector"));
      await runSuite();
      vi.doUnmock("std-env");
      vi.resetModules();
    });

    test("missing id: injects an id", async () => {
      const filePath = await writeConfig(configWithoutId);
      await ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false });
      expect(await fs.promises.readFile(filePath, "utf-8")).toMatch(/id:\s*"/);
    });

    test("dry-run + missing id: skips the check (no side effects)", async () => {
      const filePath = await writeConfig(configWithoutId);
      await expect(
        ensureConfigIdForDeploy({ configPath: filePath, dryRun: true, buildOnly: false }),
      ).resolves.toBeUndefined();
      expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithoutId);
    });
  });
});
