import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

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

  beforeEach(async () => {
    tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "config-id-ci-"));
  });

  afterEach(async () => {
    await fs.promises.rm(tempDir, { recursive: true, force: true });
    vi.resetModules();
    vi.doUnmock("std-env");
  });

  async function writeConfig(source: string): Promise<string> {
    const filePath = path.join(tempDir, "tailor.config.ts");
    await fs.promises.writeFile(filePath, source, "utf-8");
    return filePath;
  }

  async function load(isCI: boolean) {
    vi.doMock("std-env", () => ({ isCI }));
    return import("./config-id-injector");
  }

  test("CI + missing id: throws with remediation guidance", async () => {
    const filePath = await writeConfig(configWithoutId);
    const { ensureConfigIdForDeploy } = await load(true);
    await expect(
      ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
    ).rejects.toThrow(/missing an 'id'|setup github|apply/);
    // Must not have injected anything in CI.
    expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithoutId);
  });

  test("CI + existing id: passes without mutating the file", async () => {
    const filePath = await writeConfig(configWithId);
    const { ensureConfigIdForDeploy } = await load(true);
    await expect(
      ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false }),
    ).resolves.toBeUndefined();
    expect(await fs.promises.readFile(filePath, "utf-8")).toBe(configWithId);
  });

  test("local + missing id: injects an id", async () => {
    const filePath = await writeConfig(configWithoutId);
    const { ensureConfigIdForDeploy } = await load(false);
    await ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: false });
    expect(await fs.promises.readFile(filePath, "utf-8")).toMatch(/id:\s*"/);
  });

  test("CI + dry-run: skips the check entirely", async () => {
    const filePath = await writeConfig(configWithoutId);
    const { ensureConfigIdForDeploy } = await load(true);
    await expect(
      ensureConfigIdForDeploy({ configPath: filePath, dryRun: true, buildOnly: false }),
    ).resolves.toBeUndefined();
  });

  test("CI + build-only: skips the check entirely", async () => {
    const filePath = await writeConfig(configWithoutId);
    const { ensureConfigIdForDeploy } = await load(true);
    await expect(
      ensureConfigIdForDeploy({ configPath: filePath, dryRun: false, buildOnly: true }),
    ).resolves.toBeUndefined();
  });
});
