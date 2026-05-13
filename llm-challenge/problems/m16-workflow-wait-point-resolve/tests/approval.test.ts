import path from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

type WaitHandler = (key: string, payload: unknown) => unknown;

type GlobalWithTailor = typeof globalThis & {
  tailor?: { workflow: { wait: WaitHandler } };
};

function setupWaitPointMock(handler: WaitHandler): {
  waitCalls: { key: string; payload: unknown }[];
} {
  const waitCalls: { key: string; payload: unknown }[] = [];
  (globalThis as GlobalWithTailor).tailor = {
    workflow: {
      wait: (key, payload) => {
        waitCalls.push({ key, payload });
        return handler(key, payload);
      },
    },
  };
  return { waitCalls };
}

function cleanupWaitPointMock(): void {
  delete (globalThis as GlobalWithTailor).tailor;
}

describe.skipIf(!workDirReady)("m16-workflow-wait-point-resolve", () => {
  afterEach(() => {
    cleanupWaitPointMock();
  });

  test("default export is the 'approval-workflow' with processApproval as mainJob", async () => {
    const mod = await importPath(path.join(workDir, "workflows/approval.ts"));
    expect(mod.default).toBeDefined();
    expect(mod.default.name).toBe("approval-workflow");
    expect(mod.default.mainJob.name).toBe("process-approval");
  });

  test("approval wait point is exported as a named export (not bundled into default)", async () => {
    const mod = await importPath(path.join(workDir, "workflows/approval.ts"));
    expect(mod.approval).toBeDefined();
    expect(typeof mod.approval.wait).toBe("function");
    expect(typeof mod.approval.resolve).toBe("function");
  });

  test("processApproval returns 'approved' when the wait point resolves with approved:true", async () => {
    const { waitCalls } = setupWaitPointMock(() => ({ approved: true }));
    const mod = await importPath(path.join(workDir, "workflows/approval.ts"));
    const result = await mod.processApproval.body({ requestId: "req-1" });
    expect(result).toEqual({ requestId: "req-1", status: "approved" });
    expect(waitCalls).toHaveLength(1);
    expect(waitCalls[0]?.key).toBe("approval");
  });

  test("processApproval returns 'rejected' when the wait point resolves with approved:false", async () => {
    setupWaitPointMock(() => ({ approved: false }));
    const mod = await importPath(path.join(workDir, "workflows/approval.ts"));
    const result = await mod.processApproval.body({ requestId: "req-2" });
    expect(result).toEqual({ requestId: "req-2", status: "rejected" });
  });
});
