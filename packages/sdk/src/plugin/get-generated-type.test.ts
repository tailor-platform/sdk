import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { product } from "./__tests__/fixtures/types/product";
import { _clearCacheForTesting, getGeneratedType } from "./get-generated-type";

const fixtureConfigPath = join(import.meta.dirname, "__tests__/fixtures/tailor.config.ts");

declare global {
  // oxlint-disable-next-line no-var
  var __testProcessNamespaceCalls: string[];
}

describe("getGeneratedType", () => {
  beforeEach(() => {
    _clearCacheForTesting();
  });

  it("returns generated type for changeset plugin", async () => {
    const result = await getGeneratedType(fixtureConfigPath, "@tailor-platform/changeset", product, "request");

    expect(result.name).toBe("ProductChangeRequest");
  });

  it("returns different kinds from the same plugin", async () => {
    const request = await getGeneratedType(fixtureConfigPath, "@tailor-platform/changeset", product, "request");
    const step = await getGeneratedType(fixtureConfigPath, "@tailor-platform/changeset", product, "step");
    const approval = await getGeneratedType(fixtureConfigPath, "@tailor-platform/changeset", product, "approval");
    const rework = await getGeneratedType(fixtureConfigPath, "@tailor-platform/changeset", product, "rework");

    expect(request.name).toBe("ProductChangeRequest");
    expect(step.name).toBe("ProductChangeStep");
    expect(approval.name).toBe("ProductChangeApproval");
    expect(rework.name).toBe("ProductChangeReworkEvent");
  });

  it("throws for unknown plugin", async () => {
    await expect(
      getGeneratedType(fixtureConfigPath, "unknown-plugin", product, "request"),
    ).rejects.toThrow(/Plugin "unknown-plugin" not found/);
  });

  it("throws for unknown kind", async () => {
    await expect(
      getGeneratedType(fixtureConfigPath, "@tailor-platform/changeset", product, "nonexistent"),
    ).rejects.toThrow(/Generated type not found/);
  });

  describe("namespace plugin", () => {
    let tempDir: string;
    let configPath: string;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
      configPath = path.join(tempDir, "tailor.config.mjs");
    });

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true });
    });

    it("processNamespace is called only once per namespace during resolution", async () => {
      fs.writeFileSync(
        configPath,
        `export const plugins = [{
  id: "ns-plugin",
  description: "test",
  importPath: "@test/ns-plugin",
  processNamespace({ pluginConfig, namespace }) {
    globalThis.__testProcessNamespaceCalls.push(namespace);
    return {
      types: {
        auditLog: { name: "AuditLog", fields: { message: {} } },
      },
    };
  },
}];
export default {
  db: {
    main: { files: [] },
  },
};
`,
      );

      globalThis.__testProcessNamespaceCalls = [];

      await getGeneratedType(configPath, "ns-plugin", null, "auditLog");

      expect(globalThis.__testProcessNamespaceCalls).toEqual(["main"]);
    });
  });
});
