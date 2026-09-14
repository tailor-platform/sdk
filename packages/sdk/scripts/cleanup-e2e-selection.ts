// Workspace selection for the e2e cleanup script, kept apart from the script's
// CLI entrypoint so importing it (from a test) starts no platform work.
import { timestampDate } from "@bufbuild/protobuf/wkt";
import type { Timestamp } from "@bufbuild/protobuf/wkt";

/**
 * Name prefixes of the workspaces CI creates, longest first so
 * `sdk-ci-migration-` wins over `sdk-ci-`.
 * Keep in sync with the run-id regex in .github/workflows/cleanup-e2e-workspaces.yml.
 */
export const E2E_WORKSPACE_PREFIXES = [
  "e2e-ws-",
  "template-e2e-",
  "sdk-ci-migration-",
  "sdk-ci-",
] as const;

/** The numeric run id right after a recognized prefix. */
const RUN_ID_PATTERN = new RegExp(`^(?:${E2E_WORKSPACE_PREFIXES.join("|")})(\\d+)`);

export interface CleanupWorkspace {
  id?: string;
  name?: string;
  createTime?: Timestamp;
}

export interface SelectionOptions {
  /** CI run id the workspaces must belong to. */
  runId?: string;
  /** Restrict to workspaces whose name carries no run id. */
  localOrphans?: boolean;
  /** Minimum age in hours, used with `localOrphans`. */
  minAgeHours?: number;
}

/**
 * The recognized prefix a name starts with, if any.
 * @param name - Workspace name
 * @returns The matching prefix, or undefined
 */
function matchedPrefix(name: string): string | undefined {
  return E2E_WORKSPACE_PREFIXES.find((prefix) => name.startsWith(prefix));
}

/**
 * Whether a name carries this run id as a whole segment right after its prefix.
 * A substring test would let run id "123" match run "1234"'s workspaces, so the
 * segment must end at a hyphen or at the end of the name.
 * @param name - Workspace name
 * @param runId - Run id to match
 * @returns Whether the name belongs to that run
 */
function belongsToRun(name: string, runId: string): boolean {
  const prefix = matchedPrefix(name);
  if (!prefix) return false;
  const rest = name.slice(prefix.length);
  return rest === runId || rest.startsWith(`${runId}-`);
}

/**
 * Pick the workspaces to delete out of every workspace the caller can see.
 * @param workspaces - Workspaces to filter
 * @param options - Selection options
 * @param now - Reference time for the local-orphan age check
 * @returns The workspaces to delete, in input order
 */
export function selectWorkspacesToDelete(
  workspaces: readonly CleanupWorkspace[],
  options: SelectionOptions,
  now: Date,
): CleanupWorkspace[] {
  return workspaces.filter((ws) => {
    const name = ws.name;
    if (!name || !matchedPrefix(name)) return false;
    if (options.localOrphans) {
      if (RUN_ID_PATTERN.test(name)) return false;
      const createdAt = ws.createTime ? timestampDate(ws.createTime) : undefined;
      if (!createdAt) return false;
      return (now.getTime() - createdAt.getTime()) / 3_600_000 >= (options.minAgeHours ?? 0);
    }
    if (options.runId) return belongsToRun(name, options.runId);
    return true;
  });
}
