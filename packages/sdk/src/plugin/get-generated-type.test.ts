import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { _clearCacheForTesting, getGeneratedType } from "./get-generated-type";

declare global {
  // oxlint-disable-next-line no-var
  var __testProcessNamespaceCalls: string[];
}

describe("getGeneratedType", () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    _clearCacheForTesting();
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-test-"));
    configPath = path.join(tempDir, "tailor.config.mjs");
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("namespace plugin", () => {
    it("onNamespaceLoaded is called only once per namespace during resolution", async () => {
      fs.writeFileSync(
        configPath,
        `export const plugins = [{
  id: "ns-plugin",
  description: "test",
  importPath: "@test/ns-plugin",
  onNamespaceLoaded({ pluginConfig, namespace }) {
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

      // onNamespaceLoaded for "main" should be called exactly once.
      // Bug: currently called twice - once in resolveNamespaceForNamespacePlugin (result discarded),
      // and once again in getGeneratedTypeForNamespacePlugin.
      expect(globalThis.__testProcessNamespaceCalls).toEqual(["main"]);
    });
  });
});
