import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "pathe";
import { z } from "zod";
import { getDistDir } from "#/cli/shared/dist-dir";

const SecretsStateSchema = z.object({
  vaults: z.record(z.string(), z.record(z.string(), z.string())),
  connections: z.record(z.string(), z.string()).optional(),
});

const PersistedSecretsStateSchema = z.object({
  version: z.literal(1),
  workspaceId: z.string(),
  applicationKey: z.string(),
  state: SecretsStateSchema,
});

export type SecretsState = z.infer<typeof SecretsStateSchema>;
type PersistedSecretsState = z.infer<typeof PersistedSecretsStateSchema>;

export interface SecretsStateScope {
  readonly workspaceId: string;
  readonly applicationId: string | undefined;
  readonly applicationName: string;
}

/**
 * Get the file path for one workspace and application's secrets state JSON.
 * @param scope - Workspace and application identity for the deployment
 * @returns Absolute path to the scoped state file
 */
export function getSecretsStatePath(scope: SecretsStateScope): string {
  const scopeHash = hashValue(JSON.stringify([scope.workspaceId, applicationStateKey(scope)]));
  return path.join(getDistDir(), "secrets-state", `${scopeHash}.json`);
}

function loadPersistedSecretsState(scope: SecretsStateScope): PersistedSecretsState | undefined {
  try {
    const raw = readFileSync(getSecretsStatePath(scope), "utf-8");
    const persistedState = PersistedSecretsStateSchema.parse(JSON.parse(raw));
    if (
      persistedState.workspaceId !== scope.workspaceId ||
      persistedState.applicationKey !== applicationStateKey(scope)
    ) {
      return undefined;
    }
    return persistedState;
  } catch {
    return undefined;
  }
}

function applicationStateKey(scope: SecretsStateScope): string {
  if (!scope.applicationId) {
    throw new Error(`Application "${scope.applicationName}" has no stable id for secrets state`);
  }
  return `id:${scope.applicationId}`;
}

/**
 * Load secrets hash state for one workspace and application from disk.
 * @param scope - Workspace and application identity for the deployment
 * @returns Persisted state, or empty state if the scope is missing or the file is invalid
 */
export function loadSecretsState(scope: SecretsStateScope): SecretsState {
  if (!scope.applicationId) {
    return { vaults: {} };
  }
  return loadPersistedSecretsState(scope)?.state ?? { vaults: {} };
}

/**
 * Save secrets hash state for one workspace and application to disk.
 * @param scope - Workspace and application identity for the deployment
 * @param state - The secrets state to persist
 */
export function saveSecretsState(scope: SecretsStateScope, state: SecretsState): void {
  if (!scope.applicationId) {
    return;
  }
  const filePath = getSecretsStatePath(scope);
  const dir = path.dirname(filePath);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    filePath,
    JSON.stringify(
      {
        version: 1,
        workspaceId: scope.workspaceId,
        applicationKey: applicationStateKey(scope),
        state,
      } satisfies PersistedSecretsState,
      null,
      2,
    ),
    "utf-8",
  );
}

/**
 * Compute SHA-256 hex digest of a value.
 * @param value - The string to hash
 * @returns Hex-encoded SHA-256 hash
 */
export function hashValue(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
