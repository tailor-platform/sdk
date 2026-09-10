import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { confirmationArgs } from "#/cli/shared/args";
import { fetchPaged, initOperatorClient, type OperatorClient } from "#/cli/shared/client";
import { defineAppCommand } from "#/cli/shared/command";
import { loadAccessToken, loadPlatformClientConfig } from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { formatTimestamp } from "#/cli/shared/format";
import { logger } from "#/cli/shared/logger";
import { profileNameSchema } from "#/cli/shared/profile-name";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import ml from "#/utils/multiline";
import { removeProfilesForWorkspaces } from "./profile-cleanup";
import {
  workspaceDisplayName,
  workspaceInfosWithFolderNames,
  workspaceNameTransformer,
  type WorkspaceInfo,
} from "./transform";
import type { Workspace } from "@tailor-platform/tailor-proto/workspace_resource_pb";

const agePattern = /^(\d+)(s|m|h|d)$/;

const ageUnitToMs = {
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
} as const;

// "" (an unset CI secret) is kept distinct from an omitted option so the run can refuse to sweep
// unscoped. Fresh per option, like `limitArg`.
const scopeIdArg = () => z.union([z.literal(""), z.uuid()]).optional();

// Rejects `--limit=` instead of coercing "" to 0. Single-use: politty does not clone pipe schemas per option.
const limitArg = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? Number.NaN : value),
  z.coerce.number().int().nonnegative(),
);

const ageArg = z.string().regex(agePattern, {
  message: "Invalid --older-than format. Expected a number with a unit: '30m', '24h', '7d'",
});

/**
 * Parse a validated age string into milliseconds.
 * @param age - Age string such as `30m`, `24h`, or `7d`
 * @returns Age in milliseconds
 */
export function parseAge(age: string): number {
  const match = age.match(agePattern);
  if (!match?.[1] || !match[2]) {
    throw new Error(`invalid age format: ${age}`);
  }
  const unit = match[2] as keyof typeof ageUnitToMs;
  return parseInt(match[1], 10) * ageUnitToMs[unit];
}

export interface PruneCriteria {
  /** Regexes; a workspace matches when any of them matches its whole name. */
  nameRegexes: readonly RegExp[];
  /** Minimum age since creation, in milliseconds. `0` selects any age. */
  olderThanMs: number;
  organizationId?: string;
  folderId?: string;
  /** Exact names kept even when they match. */
  exclude: ReadonlySet<string>;
}

export interface PruneSelection {
  /** Workspaces to delete. */
  candidates: Workspace[];
  /** Matching workspaces kept because they are excluded by name. */
  excluded: Workspace[];
  /** Matching workspaces kept because delete protection is enabled. */
  protectedSkipped: Workspace[];
  /** Matching workspaces kept because their age is unknown. */
  missingCreateTime: Workspace[];
  /** Matching workspaces younger than the threshold. */
  tooYoung: Workspace[];
}

function matchesName(workspace: Workspace, criteria: PruneCriteria): boolean {
  return criteria.nameRegexes.some((regex) => regex.test(workspace.name));
}

function matchesScope(workspace: Workspace, criteria: PruneCriteria): boolean {
  if (criteria.organizationId && workspace.organizationId !== criteria.organizationId) {
    return false;
  }
  if (criteria.folderId && workspace.folderId !== criteria.folderId) {
    return false;
  }
  return true;
}

/**
 * Re-check a candidate against the criteria that selected it.
 * @param workspace - Workspace as it exists now
 * @param criteria - Selection criteria the candidate was chosen with
 * @returns Why the candidate no longer qualifies, or `undefined` when it still does
 */
function staleCandidateReason(workspace: Workspace, criteria: PruneCriteria): string | undefined {
  if (workspace.deleteProtection) return "delete protection was turned on";
  if (!matchesScope(workspace, criteria)) return "it moved outside the requested scope";
  if (!matchesName(workspace, criteria)) return "it no longer matches the name filter";
  if (criteria.exclude.has(workspace.name)) return "it is now excluded by --exclude";
  return undefined;
}

/**
 * Split workspaces into the ones to delete and the matching ones that are kept.
 * @param workspaces - Workspaces visible to the caller
 * @param criteria - Selection criteria
 * @param now - Reference time for the age threshold
 * @returns Candidates plus the matching workspaces kept, grouped by reason
 */
export function selectPruneCandidates(
  workspaces: readonly Workspace[],
  criteria: PruneCriteria,
  now: Date,
): PruneSelection {
  const selection: PruneSelection = {
    candidates: [],
    excluded: [],
    protectedSkipped: [],
    missingCreateTime: [],
    tooYoung: [],
  };
  const cutoff = now.getTime() - criteria.olderThanMs;

  for (const workspace of workspaces) {
    if (!matchesScope(workspace, criteria) || !matchesName(workspace, criteria)) continue;
    if (criteria.exclude.has(workspace.name)) {
      selection.excluded.push(workspace);
      continue;
    }
    if (workspace.deleteProtection) {
      selection.protectedSkipped.push(workspace);
      continue;
    }
    const createdAt = formatTimestamp(workspace.createTime);
    if (!createdAt) {
      selection.missingCreateTime.push(workspace);
      continue;
    }
    if (createdAt.getTime() > cutoff) {
      selection.tooYoung.push(workspace);
      continue;
    }
    selection.candidates.push(workspace);
  }

  return selection;
}

async function fetchAllWorkspaces(client: OperatorClient): Promise<Workspace[]> {
  return fetchPaged(async (pageToken, pageSize) => {
    const { workspaces, nextPageToken } = await client.listWorkspaces({ pageToken, pageSize });
    return [workspaces, nextPageToken];
  });
}

function compileNameRegex(pattern: string): RegExp {
  try {
    // The bare compile rejects unbalanced parentheses that would escape the anchoring group.
    new RegExp(pattern);
    return new RegExp(`^(?:${pattern})$`);
  } catch (error) {
    throw CLIError({
      code: "INVALID_NAME_PATTERN",
      message: `Invalid --name "${pattern}".`,
      details: error instanceof Error ? error.message : String(error),
    });
  }
}

interface PruneResult {
  dryRun: boolean;
  candidates: WorkspaceInfo[];
  deleted: WorkspaceInfo[];
  failed: { workspace: WorkspaceInfo; error: string }[];
  skipped: {
    excluded: string[];
    deleteProtection: string[];
    unknownAge: string[];
    /** Candidates dropped because they changed between listing and deletion. */
    changed: string[];
  };
}

const KEPT_REASONS: {
  key: Exclude<keyof PruneResult["skipped"], "changed">;
  selection: Exclude<keyof PruneSelection, "candidates" | "tooYoung">;
  reason: string;
}[] = [
  { key: "excluded", selection: "excluded", reason: "excluded by --exclude" },
  { key: "deleteProtection", selection: "protectedSkipped", reason: "delete protection is on" },
  { key: "unknownAge", selection: "missingCreateTime", reason: "creation time is unknown" },
];

export const pruneCommand = defineAppCommand({
  name: "prune",
  description: "Delete stale temporary workspaces that match a name filter and an age threshold.",
  notes: ml`
    Use this to reclaim workspaces left behind by CI runs, preview deployments, or interrupted local test runs. A workspace is deleted only when its whole name matches a --name pattern, it was created at least --older-than ago, and it is not excluded, delete-protected, or outside the --organization-id / --folder-id scope. Run with --dry-run first to see what would be deleted.

    Safety guards: the command aborts without deleting anything when more workspaces match than --limit allows (--dry-run still lists them all), --older-than 0s (no age check) is only accepted together with --organization-id or --folder-id, and a scope option that resolves to an empty value (an unset CI secret) is rejected instead of silently widening the sweep. Each workspace is re-read immediately before it is deleted and skipped when it no longer matches the name, scope, exclusion, or delete-protection criteria that selected it. Unlike \`workspace delete\`, a single confirmation covers every listed candidate; pass --yes to skip it in CI. Deleted workspaces can be restored with \`workspace restore\` for a limited time.

    Only workspaces visible to the current login (or the machine user in CI) are considered.
  `,
  args: z.strictObject({
    name: arg(z.array(z.string().min(1)).optional(), {
      description:
        "Select workspaces whose whole name matches this regular expression (repeatable)",
    }),
    "older-than": arg(ageArg, {
      description:
        "Minimum age since creation, such as 30m, 24h, or 7d. 0s disables the age check and requires --organization-id or --folder-id",
    }),
    "organization-id": arg(scopeIdArg(), {
      alias: "o",
      description: "Only consider workspaces in this organization",
      env: "TAILOR_PLATFORM_ORGANIZATION_ID",
    }),
    "folder-id": arg(scopeIdArg(), {
      description: "Only consider workspaces in this folder",
      env: "TAILOR_PLATFORM_FOLDER_ID",
    }),
    exclude: arg(z.array(z.string().min(1)).optional(), {
      description: "Keep a workspace with this exact name even when it matches (repeatable)",
    }),
    limit: arg(limitArg.default(20), {
      description:
        "Abort when more workspaces match than this, without deleting anything. 0 removes the cap",
    }),
    "dry-run": arg(z.boolean().default(false), {
      description: "List the workspaces that would be deleted without deleting them",
    }),
    profile: arg(profileNameSchema.optional(), {
      description: "Workspace profile used for authentication and Platform selection",
      env: "TAILOR_PLATFORM_PROFILE",
    }),
    ...confirmationArgs,
  }),
  run: async (args) => {
    const namePatterns = args.name ?? [];
    if (namePatterns.length === 0) {
      throw CLIError({
        code: "MISSING_NAME_FILTER",
        message: "Specify at least one --name.",
        details: "Only workspaces whose name matches the filter are considered for deletion.",
      });
    }
    const emptyScopeOptions = (
      [
        ["--organization-id", args["organization-id"]],
        ["--folder-id", args["folder-id"]],
      ] as const
    )
      .filter(([, value]) => value === "")
      .map(([option]) => option);
    if (emptyScopeOptions.length > 0) {
      throw CLIError({
        code: "EMPTY_SCOPE",
        message: `${emptyScopeOptions.join(" and ")} resolved to an empty value.`,
        details:
          "An empty scope is indistinguishable from no scope, so the sweep would cover every visible workspace. This usually means an unset CI secret.",
        suggestion:
          "Set the id (or its environment variable), or drop the option to sweep without a scope on purpose.",
      });
    }
    const organizationId = args["organization-id"] || undefined;
    const folderId = args["folder-id"] || undefined;

    const olderThanMs = parseAge(args["older-than"]);
    if (olderThanMs === 0 && !organizationId && !folderId) {
      throw CLIError({
        code: "UNSCOPED_ZERO_AGE",
        message: "--older-than 0s requires --organization-id or --folder-id.",
        details:
          "Without an age check the name filter is the only guard, so the sweep must be scoped to an organization or folder.",
      });
    }
    const criteria: PruneCriteria = {
      nameRegexes: namePatterns.map(compileNameRegex),
      olderThanMs,
      organizationId,
      folderId,
      exclude: new Set(args.exclude ?? []),
    };

    await assertWritable({ profile: args.profile });
    const accessToken = await loadAccessToken({ profile: args.profile });
    const platformConfig = await loadPlatformClientConfig({ profile: args.profile });
    const client = await initOperatorClient(accessToken, platformConfig);

    const selection = selectPruneCandidates(await fetchAllWorkspaces(client), criteria, new Date());

    const result: PruneResult = {
      dryRun: args["dry-run"],
      candidates: [],
      deleted: [],
      failed: [],
      skipped: { excluded: [], deleteProtection: [], unknownAge: [], changed: [] },
    };
    for (const { key, selection: group, reason } of KEPT_REASONS) {
      for (const workspace of selection[group]) {
        result.skipped[key].push(workspace.name);
        logger.warn(`Keeping ${workspace.name} (${workspace.id}): ${reason}.`);
      }
    }
    if (selection.tooYoung.length > 0) {
      logger.info(
        `${selection.tooYoung.length} matching workspace(s) are younger than ${args["older-than"]} and were kept.`,
      );
    }

    if (selection.candidates.length === 0) {
      logger.info("No stale workspaces matched.");
      if (logger.jsonMode) logger.out(result);
      return;
    }
    const overLimit = args.limit > 0 && selection.candidates.length > args.limit;
    if (overLimit && !args["dry-run"]) {
      throw CLIError({
        code: "PRUNE_LIMIT_EXCEEDED",
        message: `${selection.candidates.length} workspaces matched, but --limit is ${args.limit}. Nothing was deleted.`,
        details: "A match count this high usually means the name filter is broader than intended.",
        suggestion:
          "Check the filter with --dry-run, then raise --limit (or pass --limit 0) if every match should be deleted.",
      });
    }

    result.candidates = await workspaceInfosWithFolderNames(client, selection.candidates);
    if (!logger.jsonMode) {
      logger.out(result.candidates, {
        display: {
          name: workspaceNameTransformer,
          folderName: null,
          organizationId: null,
          folderId: null,
          updatedAt: null,
        },
      });
    }

    if (args["dry-run"]) {
      if (overLimit) {
        logger.warn(
          `${result.candidates.length} workspaces matched, but --limit is ${args.limit}: a real run would abort without deleting anything.`,
        );
      }
      logger.info(`Dry run: ${result.candidates.length} workspace(s) would be deleted.`);
      if (logger.jsonMode) logger.out(result);
      return;
    }

    if (!args.yes) {
      const confirmed = await prompt.confirm({
        message: `Delete these ${result.candidates.length} workspace(s)? They can be restored with "tailor workspace restore" for a limited time.`,
        default: false,
      });
      if (!confirmed) {
        logger.info("Prune cancelled. No workspaces were deleted.");
        if (logger.jsonMode) logger.out(result);
        return;
      }
    }

    for (const workspace of result.candidates) {
      const displayName = workspaceDisplayName(workspace);
      try {
        // The confirmation prompt leaves a window in which the workspace can change, so the
        // criteria that selected it are re-checked against a fresh read before it is deleted.
        const { workspace: current } = await client.getWorkspace({ workspaceId: workspace.id });
        const staleReason = current ? staleCandidateReason(current, criteria) : undefined;
        if (staleReason) {
          result.skipped.changed.push(workspace.name);
          logger.warn(`Keeping ${displayName} (${workspace.id}): ${staleReason}.`);
          continue;
        }
        await client.deleteWorkspace({ workspaceId: workspace.id });
        result.deleted.push(workspace);
        logger.success(`Deleted ${displayName} (${workspace.id}).`);
      } catch (error) {
        if (error instanceof ConnectError && error.code === Code.NotFound) {
          result.deleted.push(workspace);
          logger.info(`${displayName} (${workspace.id}) was already deleted.`);
          continue;
        }
        const message = error instanceof Error ? error.message : String(error);
        result.failed.push({ workspace, error: message });
        logger.error(`Failed to delete ${displayName} (${workspace.id}): ${message}`);
      }
    }

    // A failed delete can still have removed the workspace server-side (a timeout after the
    // server committed), so its local profile is cleaned up alongside the confirmed deletions.
    const removedProfiles = await removeProfilesForWorkspaces(
      new Set(
        [...result.deleted, ...result.failed.map(({ workspace }) => workspace)].map(
          (workspace) => workspace.id,
        ),
      ),
    );
    if (removedProfiles.length > 0) {
      logger.info(
        `Removed ${removedProfiles.length} local profile(s) that pointed at deleted workspaces: ${removedProfiles.join(", ")}.`,
      );
    }

    if (logger.jsonMode) logger.out(result);
    logger.success(`Deleted ${result.deleted.length} workspace(s).`);
    if (result.failed.length > 0) {
      throw CLIError({
        code: "PRUNE_INCOMPLETE",
        message: `Failed to delete ${result.failed.length} workspace(s).`,
        suggestion:
          "Fix the reported errors and run the command again; deleted workspaces are not retried.",
      });
    }
  },
});
