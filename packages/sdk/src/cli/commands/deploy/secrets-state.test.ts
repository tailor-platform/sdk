import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  getSecretsStatePath,
  hashValue,
  loadSecretsState,
  saveSecretsState,
} from "./secrets-state";

vi.mock("#/cli/shared/dist-dir", () => ({
  getDistDir: () => "/tmp/tailor-test-secrets-state",
}));

function removeStateFile(): void {
  const statePath = getSecretsStatePath();
  if (existsSync(statePath)) {
    rmSync(statePath);
  }
}

describe("secrets-state", () => {
  beforeEach(removeStateFile);
  afterEach(removeStateFile);

  test("loadSecretsState returns empty state when file does not exist", () => {
    const state = loadSecretsState();
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
    saveSecretsState(state);
    const loaded = loadSecretsState();
    expect(loaded).toEqual(state);
  });

  test("loadSecretsState returns empty state when file contains invalid JSON", () => {
    const statePath = getSecretsStatePath();
    mkdirSync(path.dirname(statePath), { recursive: true });
    writeFileSync(statePath, "{broken json,,,", "utf-8");
    const state = loadSecretsState();
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
