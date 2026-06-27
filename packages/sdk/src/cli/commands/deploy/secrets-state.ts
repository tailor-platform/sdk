import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import { z } from "zod";
import { getDistDir } from "#/cli/shared/dist-dir";

// strip unknown keys
const SecretsStateSchema = z.object({
  vaults: z.record(z.string(), z.record(z.string(), z.string())),
  connections: z.record(z.string(), z.string()).optional(),
});

export type SecretsState = z.infer<typeof SecretsStateSchema>;

/**
 * Get the file path for the secrets state JSON.
 * @returns Absolute path to secrets-state.json
 */
export function getSecretsStatePath(): string {
  return path.join(getDistDir(), "secrets-state.json");
}

/**
 * Load secrets hash state from disk.
 * @returns Persisted state, or empty state if file is missing or corrupted
 */
export function loadSecretsState(): SecretsState {
  const filePath = getSecretsStatePath();
  if (!existsSync(filePath)) {
    return { vaults: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return SecretsStateSchema.parse(JSON.parse(raw));
  } catch {
    return { vaults: {} };
  }
}

/**
 * Save secrets hash state to disk.
 * @param state - The secrets state to persist
 */
export function saveSecretsState(state: SecretsState): void {
  const filePath = getSecretsStatePath();
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Compute SHA-256 hex digest of a value.
 * @param value - The string to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
