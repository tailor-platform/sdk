import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m13-executor-resolver-trigger", () => {
  test("executor name is 'upgrade-audit' and has a non-empty description", async () => {
    const mod = await importPath(path.join(workDir, "executors/upgradeAudit.ts"));
    expect(mod.default.name).toBe("upgrade-audit");
    expectNonEmptyDescription(mod.default);
  });

  test("trigger targets the 'upgrade' resolver execution", async () => {
    const mod = await importPath(path.join(workDir, "executors/upgradeAudit.ts"));
    const { trigger } = mod.default;
    expect(trigger.kind).toBe("resolverExecuted");
    expect(trigger.resolverName).toBe("upgrade");
  });

  test("trigger condition only fires on success", async () => {
    const mod = await importPath(path.join(workDir, "executors/upgradeAudit.ts"));
    const { condition } = mod.default.trigger;
    expect(typeof condition).toBe("function");
    expect(condition({ success: true, result: { customerId: "c1", plan: "PRO" } })).toBe(true);
    expect(condition({ success: false, error: "boom" })).toBeFalsy();
  });

  test("operation is a function whose body accepts trigger args", async () => {
    const mod = await importPath(path.join(workDir, "executors/upgradeAudit.ts"));
    expectFunctionOperation(mod.default);
  });
});
