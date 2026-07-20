import { existsSync, rmSync } from "node:fs";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { applyAuthConnections, type planAuthConnections } from "./auth-connection";
import { applySecretManager, type planSecretManager } from "./secret-manager";
import { hashValue, loadSecretsState } from "./secrets-state";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";

const distDir = "/tmp/tailor-sdk-test-secrets-state-concurrency";

vi.mock("#/cli/shared/dist-dir", () => ({
  getDistDir: () => "/tmp/tailor-sdk-test-secrets-state-concurrency",
}));

const stateScope = {
  workspaceId: "ws-1",
  applicationId: "app-1",
  applicationName: "test-app",
};

const application = {
  name: "test-app",
  id: "app-1",
  secrets: [],
} as unknown as Application;

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function removeStateDir(): void {
  if (existsSync(distDir)) {
    rmSync(distDir, { recursive: true });
  }
}

function secretUpdate(secretName: string, value: string) {
  return {
    name: `my-vault/${secretName}`,
    secretName,
    workspaceId: "ws-1",
    vaultName: "my-vault",
    value,
  };
}

function secretPlanResult(updates: Array<ReturnType<typeof secretUpdate>>) {
  return {
    stateScope,
    vaultChangeSet: { creates: [], updates: [], deletes: [], replaces: [] },
    secretChangeSet: { creates: [], updates, deletes: [], replaces: [] },
  } as unknown as Awaited<ReturnType<typeof planSecretManager>>;
}

function connectionReplace(name: string, clientSecret: string) {
  return {
    name,
    updateRequest: {
      workspaceId: "ws-1",
      connection: {
        name,
        config: { case: "oauth2" as const, value: { clientSecret } },
      },
      updateMask: { paths: ["oauth2.client_secret"] },
    },
    metaRequest: { trn: `trn:${name}`, labels: {} },
  };
}

function connectionPlanResult(replaces: Array<ReturnType<typeof connectionReplace>>) {
  return {
    stateScope,
    changeSet: { creates: [], updates: [], deletes: [], replaces },
  } as unknown as Awaited<ReturnType<typeof planAuthConnections>>;
}

describe("concurrent deploys to the same target", () => {
  aroundEach(async (runTest) => {
    removeStateDir();
    await runTest();
    removeStateDir();
  });

  test("secret hash state matches the last remote write", async () => {
    const remote = new Map<string, string>();
    const bSettled = deferred();

    // Deploy A: the trailing secret's remote update settles only after deploy B
    // has fully finished (or after a grace period when B is made to wait).
    const clientA = {
      updateSecretManagerSecret: vi.fn().mockImplementation(async (req) => {
        remote.set(req.secretmanagerSecretName, req.secretmanagerSecretValue);
        if (req.secretmanagerSecretName === "trailing-secret") {
          await Promise.race([bSettled.promise, sleep(50)]);
        }
        return {};
      }),
    } as unknown as OperatorClient;

    const clientB = {
      updateSecretManagerSecret: vi.fn().mockImplementation(async (req) => {
        remote.set(req.secretmanagerSecretName, req.secretmanagerSecretValue);
        return {};
      }),
    } as unknown as OperatorClient;

    const applyA = applySecretManager(
      clientA,
      secretPlanResult([
        secretUpdate("shared-secret", "value-from-a"),
        secretUpdate("trailing-secret", "trailing-value"),
      ]),
      "create-update",
      application,
    );
    const applyB = applySecretManager(
      clientB,
      secretPlanResult([secretUpdate("shared-secret", "value-from-b")]),
      "create-update",
      application,
    );
    void applyB.catch(() => {}).finally(() => bSettled.resolve());

    await Promise.all([applyA, applyB]);

    const state = loadSecretsState(stateScope);
    expect(state.vaults["my-vault"]?.["shared-secret"]).toBe(
      hashValue(remote.get("shared-secret")!),
    );
    expect(state.vaults["my-vault"]?.["trailing-secret"]).toBe(hashValue("trailing-value"));
  });

  test("auth connection hash state matches the last remote write", async () => {
    const remote = new Map<string, string>();
    const bSettled = deferred();

    const clientA = {
      updateAuthConnection: vi.fn().mockImplementation(async (req) => {
        remote.set(req.connection.name, req.connection.config.value.clientSecret);
        if (req.connection.name === "trailing-conn") {
          await Promise.race([bSettled.promise, sleep(50)]);
        }
        return {};
      }),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    const clientB = {
      updateAuthConnection: vi.fn().mockImplementation(async (req) => {
        remote.set(req.connection.name, req.connection.config.value.clientSecret);
        return {};
      }),
      setMetadata: vi.fn().mockResolvedValue({}),
    } as unknown as OperatorClient;

    const applyA = applyAuthConnections(
      clientA,
      connectionPlanResult([
        connectionReplace("shared-conn", "secret-from-a"),
        connectionReplace("trailing-conn", "trailing-secret"),
      ]),
      "create-update",
    );
    const applyB = applyAuthConnections(
      clientB,
      connectionPlanResult([connectionReplace("shared-conn", "secret-from-b")]),
      "create-update",
    );
    void applyB.catch(() => {}).finally(() => bSettled.resolve());

    await Promise.all([applyA, applyB]);

    const state = loadSecretsState(stateScope);
    expect(state.connections?.["shared-conn"]).toBe(hashValue(remote.get("shared-conn")!));
    expect(state.connections?.["trailing-conn"]).toBe(hashValue("trailing-secret"));
  });
});
