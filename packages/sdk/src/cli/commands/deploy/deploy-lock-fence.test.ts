import { OperatorService } from "@tailor-platform/tailor-proto/service_pb";
import { describe, expect, test, vi } from "vitest";
import { DeployLockLostError } from "./deploy-lock-error";
import { fenceClient, isMutatingRpc, READ_ONLY_RPC_PREFIXES } from "./deploy-lock-fence";
import type { OperatorClient } from "#/cli/shared/client";

// Every prefix an operator RPC name may start with. A new prefix must be
// classified here (or in READ_ONLY_RPC_PREFIXES) before the fence lets it
// through, so an unfenced write cannot appear by omission.
const MUTATING_RPC_PREFIXES = [
  "add",
  "bulk",
  "clone",
  "create",
  "delete",
  "exchange",
  "exec",
  "grant",
  "invite",
  "publish",
  "register",
  "remove",
  "restart",
  "restore",
  "resume",
  "revoke",
  "set",
  "start",
  "test",
  "trigger",
  "truncate",
  "update",
  "upload",
  "upsert",
];

describe("isMutatingRpc", () => {
  test("classifies every operator RPC by a known prefix", () => {
    const names = Object.keys(OperatorService.method);
    expect(names.length).toBeGreaterThan(200);
    const unclassified = names.filter(
      (name) =>
        !READ_ONLY_RPC_PREFIXES.some((prefix) => name.startsWith(prefix)) &&
        !MUTATING_RPC_PREFIXES.some((prefix) => name.startsWith(prefix)),
    );
    expect(unclassified).toEqual([]);
  });

  test("treats only the read-only prefixes as safe", () => {
    expect(isMutatingRpc("getWorkspace")).toBe(false);
    expect(isMutatingRpc("listFunctionRegistries")).toBe(false);
    expect(isMutatingRpc("createTailorDBType")).toBe(true);
    expect(isMutatingRpc("bulkSetMetadata")).toBe(true);
    expect(isMutatingRpc("testExecScript")).toBe(true);
  });
});

describe("fenceClient", () => {
  function createClient() {
    return {
      getWorkspace: vi.fn(async () => ({ workspace: { id: "ws" } })),
      createTailorDBType: vi.fn(async () => ({})),
      updateFunctionRegistry: vi.fn(async () => ({})),
      [Symbol.for("marker")]: "kept",
    };
  }

  test("lets reads and writes through while the lock is held", async () => {
    const raw = createClient();
    const client = fenceClient(raw as unknown as OperatorClient, { assertHeld: () => {} });

    await client.getWorkspace({ workspaceId: "ws" });
    await client.createTailorDBType({ workspaceId: "ws" });

    expect(raw.getWorkspace).toHaveBeenCalledOnce();
    expect(raw.createTailorDBType).toHaveBeenCalledWith({ workspaceId: "ws" });
  });

  test("stops writes, but not reads, once the lock is lost — even through an earlier reference", async () => {
    const raw = createClient();
    let lost = false;
    const client = fenceClient(raw as unknown as OperatorClient, {
      assertHeld: () => {
        if (lost) throw new DeployLockLostError("taken over");
      },
    });
    const createType = client.createTailorDBType;
    const upload = client.updateFunctionRegistry;
    lost = true;

    await expect(client.getWorkspace({ workspaceId: "ws" })).resolves.toBeDefined();
    expect(() => createType({ workspaceId: "ws" })).toThrow(DeployLockLostError);
    expect(() => upload((async function* () {})())).toThrow(DeployLockLostError);
    expect(raw.createTailorDBType).not.toHaveBeenCalled();
    expect(raw.updateFunctionRegistry).not.toHaveBeenCalled();
  });

  test("forwards non-string properties untouched", () => {
    const raw = createClient();
    const client = fenceClient(raw as unknown as OperatorClient, { assertHeld: () => {} });

    expect((client as unknown as Record<symbol, unknown>)[Symbol.for("marker")]).toBe("kept");
  });
});
