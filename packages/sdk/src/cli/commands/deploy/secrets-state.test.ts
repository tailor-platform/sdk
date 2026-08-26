import { existsSync, mkdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import { aroundEach, describe, expect, test, vi } from "vitest";
import {
  getSecretsStatePath,
  hashValue,
  loadSecretsState,
  saveSecretsState,
  withSecretsStateLock,
} from "./secrets-state";
import type { SecretsStateScope } from "./secrets-state";

vi.mock("#/cli/shared/dist-dir", () => ({
  getDistDir: () => "/tmp/tailor-test-secrets-state",
}));

const scopeA = {
  workspaceId: "workspace-a",
  applicationId: "application-a",
  applicationName: "shared-name",
} satisfies SecretsStateScope;

const scopeB = {
  workspaceId: "workspace-b",
  applicationId: "application-b",
  applicationName: "shared-name",
} satisfies SecretsStateScope;

function removeStateFiles(): void {
  const stateDirectory = path.dirname(getSecretsStatePath(scopeA));
  if (existsSync(stateDirectory)) {
    rmSync(stateDirectory, { recursive: true });
  }
  const legacyStatePath = "/tmp/tailor-sdk-test-secrets-state/secrets-state.json";
  if (existsSync(legacyStatePath)) {
    rmSync(legacyStatePath);
  }
}

describe("secrets-state", () => {
  aroundEach(async (runTest) => {
    removeStateFiles();
    await runTest();
    removeStateFiles();
  });

  test("loadSecretsState returns empty state when file does not exist", () => {
    const state = loadSecretsState(scopeA);
    expect(state).toEqual({ vaults: {} });
  });

  test("saveSecretsState and loadSecretsState round-trip", () => {
    const state = {
      vaults: {
        "my-vault": {
          "secret-a": { hash: "abc123", updateTime: "100.5" },
          "secret-b": { hash: "def456" },
        },
      },
    };
    saveSecretsState(scopeA, state);
    const loaded = loadSecretsState(scopeA);
    expect(loaded).toEqual(state);
  });

  test("state from another workspace is a cache miss", () => {
    saveSecretsState(scopeA, {
      vaults: { "shared-vault": { "shared-secret": { hash: "matching-hash" } } },
      connections: { "shared-connection": "matching-hash" },
    });

    const loaded = loadSecretsState({
      ...scopeA,
      workspaceId: "workspace-b",
    });

    expect(loaded).toEqual({ vaults: {} });
  });

  test("state from another application is a cache miss", () => {
    saveSecretsState(scopeA, {
      vaults: { "shared-vault": { "shared-secret": { hash: "matching-hash" } } },
      connections: { "shared-connection": "matching-hash" },
    });

    const loaded = loadSecretsState({
      ...scopeA,
      applicationId: "application-b",
    });

    expect(loaded).toEqual({ vaults: {} });
  });

  test("a renamed application keeps state when its stable id matches", () => {
    saveSecretsState(scopeA, {
      vaults: { "shared-vault": { "shared-secret": { hash: "matching-hash" } } },
    });

    const loaded = loadSecretsState({
      ...scopeA,
      applicationName: "renamed-application",
    });

    expect(loaded.vaults["shared-vault"]?.["shared-secret"]?.hash).toBe("matching-hash");
  });

  test("state without a stable application id is always a cache miss", () => {
    const scopeWithoutId = {
      ...scopeA,
      applicationId: undefined,
    };

    saveSecretsState(scopeWithoutId, {
      vaults: { "shared-vault": { "shared-secret": { hash: "matching-hash" } } },
    });

    expect(loadSecretsState(scopeWithoutId)).toEqual({ vaults: {} });
    expect(existsSync(path.dirname(getSecretsStatePath(scopeA)))).toBe(false);
  });

  test("saving one scope preserves another scope", () => {
    saveSecretsState(scopeA, { vaults: { "vault-a": { secret: { hash: "hash-a" } } } });
    saveSecretsState(scopeB, { vaults: { "vault-b": { secret: { hash: "hash-b" } } } });

    expect(loadSecretsState(scopeA).vaults["vault-a"]?.secret?.hash).toBe("hash-a");
    expect(loadSecretsState(scopeB).vaults["vault-b"]?.secret?.hash).toBe("hash-b");
  });

  test("stores different scopes in different files", () => {
    expect(getSecretsStatePath(scopeA)).not.toBe(getSecretsStatePath(scopeB));
  });

  test("a malformed scope file does not invalidate another scope", () => {
    saveSecretsState(scopeB, { vaults: { "vault-b": { secret: { hash: "hash-b" } } } });
    const statePath = getSecretsStatePath(scopeA);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, "{broken json,,", "utf-8");

    expect(loadSecretsState(scopeB).vaults["vault-b"]?.secret?.hash).toBe("hash-b");
  });

  test("legacy unscoped state is a cache miss", () => {
    const statePath = "/tmp/tailor-sdk-test-secrets-state/secrets-state.json";
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
        connections: { "shared-connection": "matching-hash" },
      }),
      "utf-8",
    );

    expect(loadSecretsState(scopeA)).toEqual({ vaults: {} });
  });

  test("version 1 hash-only state is a cache miss", () => {
    const statePath = getSecretsStatePath(scopeA);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 1,
        workspaceId: scopeA.workspaceId,
        applicationKey: `id:${scopeA.applicationId}`,
        state: {
          vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
          connections: { "shared-connection": "matching-hash" },
        },
      }),
      "utf-8",
    );

    expect(loadSecretsState(scopeA)).toEqual({ vaults: {} });
  });

  test("state with an unknown version is a cache miss", () => {
    const statePath = getSecretsStatePath(scopeA);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 3,
        workspaces: {
          "workspace-a": {
            applications: {
              "id:application-a": {
                vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
              },
            },
          },
        },
      }),
      "utf-8",
    );

    expect(loadSecretsState(scopeA)).toEqual({ vaults: {} });
  });

  test("loadSecretsState returns empty state when file contains invalid JSON", () => {
    const statePath = getSecretsStatePath(scopeA);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, "{broken json,,,", "utf-8");
    const state = loadSecretsState(scopeA);
    expect(state).toEqual({ vaults: {} });
  });

  test("hashValue returns consistent SHA-256 hex digest", () => {
    const hash1 = hashValue("my-secret-value");
    const hash2 = hashValue("my-secret-value");
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  test("hashValue returns different hashes for different values", () => {
    const hash1 = hashValue("value-a");
    const hash2 = hashValue("value-b");
    expect(hash1).not.toBe(hash2);
  });
});

describe("withSecretsStateLock", () => {
  aroundEach(async (runTest) => {
    removeStateFiles();
    await runTest();
    removeStateFiles();
  });

  function lockPathFor(scope: SecretsStateScope): string {
    return `${getSecretsStatePath(scope)}.lock`;
  }

  test("returns the critical section result and releases the lock", async () => {
    const result = await withSecretsStateLock(scopeA, async () => 42);
    expect(result).toBe(42);
    expect(existsSync(lockPathFor(scopeA))).toBe(false);
  });

  test("serializes concurrent critical sections for the same scope", async () => {
    const events: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => (releaseFirst = resolve));

    const first = withSecretsStateLock(scopeA, async () => {
      events.push("first-start");
      await firstGate;
      events.push("first-end");
    });
    const second = withSecretsStateLock(scopeA, async () => {
      events.push("second-start");
    });

    await vi.waitFor(() => expect(events).toContain("first-start"));
    expect(events).toEqual(["first-start"]);

    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(["first-start", "first-end", "second-start"]);
  });

  test("releases the lock when the critical section throws", async () => {
    await expect(
      withSecretsStateLock(scopeA, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(existsSync(lockPathFor(scopeA))).toBe(false);
    await expect(withSecretsStateLock(scopeA, async () => "recovered")).resolves.toBe("recovered");
  });

  test("waits while another process holds a fresh lock", async () => {
    const lockPath = lockPathFor(scopeA);
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: 12345, token: "other" }),
    );

    const fn = vi.fn().mockResolvedValue("done");
    const pending = withSecretsStateLock(scopeA, fn);

    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(fn).not.toHaveBeenCalled();

    rmSync(lockPath, { recursive: true });
    await expect(pending).resolves.toBe("done");
  });

  test("release leaves a lock taken over by another process", async () => {
    const lockPath = lockPathFor(scopeA);
    await withSecretsStateLock(scopeA, async () => {
      writeFileSync(
        path.join(lockPath, "owner.json"),
        JSON.stringify({ pid: 12345, token: "other" }),
      );
    });

    expect(existsSync(lockPath)).toBe(true);
  });

  test("steals a lock whose lease has expired", async () => {
    const lockPath = lockPathFor(scopeA);
    mkdirSync(lockPath, { recursive: true });
    writeFileSync(
      path.join(lockPath, "owner.json"),
      JSON.stringify({ pid: 12345, token: "other" }),
    );
    const expired = new Date(Date.now() - 2 * 60 * 1000);
    utimesSync(lockPath, expired, expired);

    await expect(withSecretsStateLock(scopeA, async () => "stolen")).resolves.toBe("stolen");
    expect(existsSync(lockPath)).toBe(false);
  });

  test("runs without locking when the scope has no stable application id", async () => {
    const scopeWithoutId = { ...scopeA, applicationId: undefined };
    const result = await withSecretsStateLock(scopeWithoutId, async () => "no-lock");
    expect(result).toBe("no-lock");
    expect(existsSync(path.dirname(getSecretsStatePath(scopeA)))).toBe(false);
  });
});
