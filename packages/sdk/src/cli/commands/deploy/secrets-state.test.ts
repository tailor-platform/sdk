import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  getSecretsStatePath,
  hashValue,
  loadSecretsState,
  saveSecretsState,
} from "./secrets-state";
import type { SecretsStateScope } from "./secrets-state";

vi.mock("#/cli/shared/dist-dir", () => ({
  getDistDir: () => "/tmp/tailor-sdk-test-secrets-state",
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
  beforeEach(removeStateFiles);
  afterEach(removeStateFiles);

  test("loadSecretsState returns empty state when file does not exist", () => {
    const state = loadSecretsState(scopeA);
    expect(state).toEqual({ vaults: {} });
  });

  test("saveSecretsState and loadSecretsState round-trip", () => {
    const state = {
      vaults: {
        "my-vault": {
          "secret-a": "abc123",
          "secret-b": "def456",
        },
      },
    };
    saveSecretsState(scopeA, state);
    const loaded = loadSecretsState(scopeA);
    expect(loaded).toEqual(state);
  });

  test("state from another workspace is a cache miss", () => {
    saveSecretsState(scopeA, {
      vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
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
      vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
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
      vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
    });

    const loaded = loadSecretsState({
      ...scopeA,
      applicationName: "renamed-application",
    });

    expect(loaded.vaults["shared-vault"]?.["shared-secret"]).toBe("matching-hash");
  });

  test("state without a stable application id is always a cache miss", () => {
    const scopeWithoutId = {
      ...scopeA,
      applicationId: undefined,
    };

    saveSecretsState(scopeWithoutId, {
      vaults: { "shared-vault": { "shared-secret": "matching-hash" } },
    });

    expect(loadSecretsState(scopeWithoutId)).toEqual({ vaults: {} });
    expect(existsSync(path.dirname(getSecretsStatePath(scopeA)))).toBe(false);
  });

  test("saving one scope preserves another scope", () => {
    saveSecretsState(scopeA, { vaults: { "vault-a": { secret: "hash-a" } } });
    saveSecretsState(scopeB, { vaults: { "vault-b": { secret: "hash-b" } } });

    expect(loadSecretsState(scopeA).vaults["vault-a"]?.secret).toBe("hash-a");
    expect(loadSecretsState(scopeB).vaults["vault-b"]?.secret).toBe("hash-b");
  });

  test("stores different scopes in different files", () => {
    expect(getSecretsStatePath(scopeA)).not.toBe(getSecretsStatePath(scopeB));
  });

  test("a malformed scope file does not invalidate another scope", () => {
    saveSecretsState(scopeB, { vaults: { "vault-b": { secret: "hash-b" } } });
    const statePath = getSecretsStatePath(scopeA);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, "{broken json,,", "utf-8");

    expect(loadSecretsState(scopeB).vaults["vault-b"]?.secret).toBe("hash-b");
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

  test("state with an unknown version is a cache miss", () => {
    const statePath = getSecretsStatePath(scopeA);
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(
      statePath,
      JSON.stringify({
        version: 2,
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
