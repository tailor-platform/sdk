import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m14-executor-description-required", () => {
  test("executor name is 'user-created'", async () => {
    const mod = await importPath(path.join(workDir, "executors/userCreated.ts"));
    expect(mod.default.name).toBe("user-created");
  });

  test("executor exposes a non-empty description", async () => {
    const mod = await importPath(path.join(workDir, "executors/userCreated.ts"));
    expectNonEmptyDescription(mod.default);
  });

  test("trigger fires on User record creation", async () => {
    const mod = await importPath(path.join(workDir, "executors/userCreated.ts"));
    const { trigger } = mod.default;
    expect(trigger.kind).toBe("tailordb");
    expect(trigger.events).toEqual(["tailordb.type_record.created"]);
    expect(trigger.typeName).toBe("User");
  });

  test("operation is a function with a callable body", async () => {
    const mod = await importPath(path.join(workDir, "executors/userCreated.ts"));
    expectFunctionOperation(mod.default);
  });
});
