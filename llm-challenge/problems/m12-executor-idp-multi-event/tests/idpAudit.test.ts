import path from "node:path";
import { describe, expect, test } from "vitest";
import {
  createWorkDirContext,
  expectFunctionOperation,
  expectNonEmptyDescription,
  importPath,
} from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m12-executor-idp-multi-event", () => {
  test("executor name is 'idp-user-audit' and has a non-empty description", async () => {
    const mod = await importPath(path.join(workDir, "executors/idpAudit.ts"));
    expect(mod.default.name).toBe("idp-user-audit");
    expectNonEmptyDescription(mod.default);
  });

  test("single IdP user trigger fires on both 'created' and 'deleted' events", async () => {
    const mod = await importPath(path.join(workDir, "executors/idpAudit.ts"));
    const { trigger } = mod.default;
    expect(trigger.kind).toBe("idpUser");
    expect(trigger.events).toEqual(["idp.user.created", "idp.user.deleted"]);
  });

  test("operation is a function whose body accepts trigger args", async () => {
    const mod = await importPath(path.join(workDir, "executors/idpAudit.ts"));
    expectFunctionOperation(mod.default);
  });
});
