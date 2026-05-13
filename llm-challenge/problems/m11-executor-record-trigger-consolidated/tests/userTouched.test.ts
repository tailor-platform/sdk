import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m11-executor-record-trigger-consolidated", () => {
  test("executor name is 'user-touched' and has a non-empty description", async () => {
    const mod = await importPath(path.join(workDir, "executors/userTouched.ts"));
    expect(mod.default.name).toBe("user-touched");
    expectNonEmptyDescription(mod.default);
  });

  test("single TailorDB trigger fires on both 'created' and 'updated' events for User", async () => {
    const mod = await importPath(path.join(workDir, "executors/userTouched.ts"));
    const { trigger } = mod.default;
    expect(trigger.kind).toBe("tailordb");
    expect(trigger.typeName).toBe("User");
    expect(trigger.events).toEqual([
      "tailordb.type_record.created",
      "tailordb.type_record.updated",
    ]);
  });

  test("operation is a function whose body accepts trigger args", async () => {
    const mod = await importPath(path.join(workDir, "executors/userTouched.ts"));
    expectFunctionOperation(mod.default);
  });
});
