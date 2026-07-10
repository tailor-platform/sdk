import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import { z } from "zod";
import { getDistDir } from "#/cli/shared/dist-dir";

const SecretsStateSchema = z.object({
  vaults: z.record(z.string(), z.record(z.string(), z.string())),
  connections: z.record(z.string(), z.string()).optional(),
});

const PersistedSecretsStateSchema = z.object({
  version: z.literal(1),
  workspaces: z.record(
    z.string(),
    z.object({
      applications: z.record(z.string(), SecretsStateSchema),
    }),
  ),
});

export type SecretsState = z.infer<typeof SecretsStateSchema>;
type PersistedSecretsState = z.infer<typeof PersistedSecretsStateSchema>;

export interface SecretsStateScope {
  readonly workspaceId: string;
  readonly applicationId: string | undefined;
  readonly applicationName: string;
}

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
function loadPersistedSecretsState(): PersistedSecretsState {
  const filePath = getSecretsStatePath();
  if (!existsSync(filePath)) {
    return { version: 1, workspaces: {} };
  }
  try {
    const raw = readFileSync(filePath, "utf-8");
    return PersistedSecretsStateSchema.parse(JSON.parse(raw));
  } catch {
    return { version: 1, workspaces: {} };
  }
}

function applicationStateKey(scope: SecretsStateScope): string {
  return scope.applicationId ? `id:${scope.applicationId}` : `name:${scope.applicationName}`;
}

/**
 * Load secrets hash state for one workspace and application from disk.
 * @param scope - Workspace and application identity for the deployment
 * @returns Persisted state, or empty state if the scope is missing or the file is invalid
 */
export function loadSecretsState(scope: SecretsStateScope): SecretsState {
  return (
    loadPersistedSecretsState().workspaces[scope.workspaceId]?.applications[
      applicationStateKey(scope)
    ] ?? { vaults: {} }
  );
}

/**
 * Save secrets hash state for one workspace and application to disk.
 * @param scope - Workspace and application identity for the deployment
 * @param state - The secrets state to persist
 */
export function saveSecretsState(scope: SecretsStateScope, state: SecretsState): void {
  const filePath = getSecretsStatePath();
  const dir = path.dirname(filePath);
  const persistedState = loadPersistedSecretsState();
  const workspaceState = persistedState.workspaces[scope.workspaceId] ?? { applications: {} };
  workspaceState.applications[applicationStateKey(scope)] = state;
  persistedState.workspaces[scope.workspaceId] = workspaceState;
  mkdirSync(dir, { recursive: true });
  writeFileSync(filePath, JSON.stringify(persistedState, null, 2), "utf-8");
}

/**
 * Compute SHA-256 hex digest of a value.
 * @param value - The string to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
