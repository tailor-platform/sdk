import { Code, ConnectError } from "@connectrpc/connect";
import { arg } from "@politty/zod";
import { z } from "zod";
import { createApplyLimiter } from "#/cli/shared/apply-concurrency";
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
import { ageArg, parseAge } from "./age";
import { fetchWorkspaceExpiry, type WorkspaceExpiry } from "./expiry";
import { removeProfilesForWorkspaces } from "./profile-cleanup";
import {
  workspaceDisplayName,
  workspaceInfosWithFolderNames,
  workspaceNameTransformer,
  type WorkspaceInfo,
} from "./transform";
import type { Workspace } from "@tailor-platform/tailor-proto/workspace_resource_pb";

// "" (an unset CI secret) is kept distinct from an omitted option so the run can refuse to sweep
// unscoped. Fresh per option, like `limitArg`.
const scopeIdArg = () => z.union([z.literal(""), z.uuid()]).optional();

// Rejects `--limit=` instead of coercing "" to 0. Single-use: politty does not clone pipe schemas per option.
const limitArg = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? Number.NaN : value),
  z.coerce.number().int().nonnegative(),
);

export { parseAge };

export interface PruneCriteria {
  /** Regexes; a workspace matches when any of them matches its whole name. Empty selects every name. */
  nameRegexes: readonly RegExp[];
  /**
   * Minimum age since creation, in milliseconds. `0` selects any age.
   * `undefined` in `--expired` mode, where the recorded expiry decides.
   */
  olderThanMs?: number;
  organizationId?: string;
  folderId?: string;
  /** Select workspaces belonging to no organization and no folder. */
  personal?: boolean;
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
  // No pattern selects everything: `--expired` reaches every workspace in scope,
  // and the recorded expiry is what narrows it.
  if (criteria.nameRegexes.length === 0) return true;
  return criteria.nameRegexes.some((regex) => regex.test(workspace.name));
}

// A workspace no organization or folder owns, which an id scope cannot match.
function isPersonal(workspace: Workspace): boolean {
  return !workspace.organizationId && !workspace.folderId;
}

function matchesIdScope(workspace: Workspace, criteria: PruneCriteria): boolean {
  if (criteria.organizationId && workspace.organizationId !== criteria.organizationId) {
    return false;
  }
  if (criteria.folderId && workspace.folderId !== criteria.folderId) {
    return false;
  }
  return true;
}

function matchesScope(workspace: Workspace, criteria: PruneCriteria): boolean {
  if (criteria.personal) return isPersonal(workspace);
  return matchesIdScope(workspace, criteria);
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
    // In `--expired` mode the workspace's own recorded expiry decides, so
    // creation time is not consulted at all.
    if (criteria.olderThanMs !== undefined) {
      const createdAt = formatTimestamp(workspace.createTime);
      if (!createdAt) {
        selection.missingCreateTime.push(workspace);
        continue;
      }
      if (createdAt.getTime() > now.getTime() - criteria.olderThanMs) {
        selection.tooYoung.push(workspace);
        continue;
      }
    }
    selection.candidates.push(workspace);
  }

  return selection;
}

/** How the recorded expiry sorted the workspaces the name and scope filters kept. */
interface ExpiryPartition {
  /** Workspaces whose recorded expiry has passed. */
  expired: Workspace[];
  /** Workspaces kept because their expiry is still in the future. */
  pending: Workspace[];
  /** Workspaces kept because they record no expiry. */
  unset: Workspace[];
  /** Workspaces kept because their recorded expiry could not be read. */
  unreadable: { workspace: Workspace; reason: string }[];
}

/**
 * Sort workspaces by what their own labels say about when they may be pruned.
 *
 * Only a workspace whose recorded expiry has passed is a candidate. One that
 * records nothing, records something unreadable, or whose read failed is kept
 * — none of those states says the workspace may be deleted, and a failed read
 * in particular must never be read as "no expiry recorded".
 *
 * The reads share the apply limiter, so a sweep over every visible workspace
 * stays within the budget the CLI's other operator RPCs already contend for.
 * @param client - Operator client instance
 * @param workspaces - Workspaces the name and scope filters kept
 * @param now - Reference time
 * @returns The workspaces grouped by expiry state
 */
async function partitionByExpiry(
  client: OperatorClient,
  workspaces: readonly Workspace[],
  now: Date,
): Promise<ExpiryPartition> {
  const limit = createApplyLimiter();
  const results = await Promise.all(
    workspaces.map(async (workspace) => ({
      workspace,
      result: await limit(() => fetchWorkspaceExpiry(client, workspace.id, now)),
    })),
  );

  const partition: ExpiryPartition = { expired: [], pending: [], unset: [], unreadable: [] };
  for (const { workspace, result } of results) {
    if ("error" in result) {
      partition.unreadable.push({ workspace, reason: result.error.message });
      continue;
    }
    recordExpiryState(partition, workspace, result.expiry);
  }
  return partition;
}

function recordExpiryState(
  partition: ExpiryPartition,
  workspace: Workspace,
  expiry: WorkspaceExpiry,
): void {
  switch (expiry.state) {
    case "expired":
      partition.expired.push(workspace);
      return;
    case "pending":
      partition.pending.push(workspace);
      return;
    case "unset":
      partition.unset.push(workspace);
      return;
    case "invalid":
      partition.unreadable.push({
        workspace,
        reason: `recorded expiry "${expiry.value}" is not a value this CLI wrote`,
      });
  }
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
    /** `--expired` only: kept because the recorded expiry has not passed. */
    notExpired: string[];
    /** `--expired` only: kept because no expiry is recorded. */
    noExpiry: string[];
    /** `--expired` only: kept because the recorded expiry could not be read. */
    unreadableExpiry: string[];
    /** `--expired` only: kept because a re-read just before deleting no longer selected it. */
    expiryChanged: string[];
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
  description:
    "Delete stale temporary workspaces, by name and age or by the expiry each recorded at creation.",
  notes: ml`
    Use this to reclaim workspaces left behind by CI runs, preview deployments, or interrupted local test runs. A workspace is deleted only when its whole name matches a --name pattern, it was created at least --older-than ago, and it is not excluded, delete-protected, or outside the --organization-id / --folder-id / --personal scope. Run with --dry-run first to see what would be deleted.

    With --expired the workspaces select themselves instead: each one is deleted only once the --ttl expiry it recorded at creation has passed, so callers need no --name or --older-than. A workspace that records no expiry is never deleted this way, and neither is one whose recorded expiry cannot be read. Because that expiry is recorded on the workspace rather than derived from its name, anything able to write the workspace's metadata can bring its deletion forward -- and writing a workspace's metadata is a lesser permission than deleting it. --expired therefore requires a scope, and --name still applies on top.

    A workspace belonging to no organization and no folder is matched by neither --organization-id nor --folder-id, so --personal is what brings it into a sweep. It counts as a scope on its own and cannot be combined with --organization-id or --folder-id. Scoping to it is a deliberate choice to accept, for every organization-less workspace visible to this login, the expiry that anyone able to write a workspace's metadata may have recorded. The same restriction applies to TAILOR_PLATFORM_ORGANIZATION_ID and TAILOR_PLATFORM_FOLDER_ID: unset them before running with --personal.

    Restoring a workspace does not clear its recorded expiry, so a workspace restored after expiring is deleted again by the next --expired run. Restore it, then run \`workspace ttl set\` or \`workspace ttl clear\` before the next run — or keep it out of that run with --exclude.

    Safety guards: the command aborts without deleting anything when more workspaces match than --limit allows (--dry-run still lists them all), both --expired and --older-than 0s (no age check) are only accepted together with --organization-id, --folder-id, or --personal, and a scope option that resolves to an empty value (an unset CI secret) is rejected instead of silently widening the sweep -- --personal does not satisfy that check on an empty --organization-id or --folder-id. Each workspace is re-read immediately before it is deleted and skipped when it no longer matches the name, scope, exclusion, or delete-protection criteria that selected it. Unlike \`workspace delete\`, a single confirmation covers every listed candidate; pass --yes to skip it in CI. Deleted workspaces can be restored with \`workspace restore\` for a limited time.

    Only workspaces visible to the current login (or the machine user in CI) are considered.
  `,
  args: z.strictObject({
    name: arg(z.array(z.string().min(1)).optional(), {
      description:
        "Select workspaces whose whole name matches this regular expression (repeatable)",
    }),
    "older-than": arg(ageArg.optional(), {
      description:
        "Minimum age since creation, such as 30m, 24h, or 7d. 0s disables the age check and requires a scope. Required unless --expired is given",
    }),
    expired: arg(z.boolean().default(false), {
      description:
        "Select workspaces whose own --ttl expiry has passed, instead of by name and age. Requires --organization-id, --folder-id, or --personal",
    }),
    personal: arg(z.boolean().default(false), {
      description:
        "Only consider workspaces belonging to no organization and no folder. Cannot be combined with --organization-id or --folder-id",
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
    const olderThan = args["older-than"];
    if (args.expired && olderThan !== undefined) {
      throw CLIError({
        code: "CONFLICTING_AGE_FILTER",
        message: "--expired and --older-than cannot be combined.",
        details:
          "--expired defers to the expiry each workspace recorded at creation, which --older-than would override.",
      });
    }
    if (!args.expired && olderThan === undefined) {
      throw CLIError({
        code: "MISSING_AGE_FILTER",
        message: "Specify --older-than, or --expired to use each workspace's recorded expiry.",
      });
    }
    if (!args.expired && namePatterns.length === 0) {
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
    if (args.personal && (organizationId || folderId)) {
      throw CLIError({
        code: "CONFLICTING_SCOPE",
        message: "--personal cannot be combined with --organization-id or --folder-id.",
        suggestion:
          "Run personal and organization/folder sweeps separately. Unset TAILOR_PLATFORM_ORGANIZATION_ID and TAILOR_PLATFORM_FOLDER_ID before using --personal.",
      });
    }
    const scoped = Boolean(organizationId || folderId || args.personal);

    if (args.expired && !scoped) {
      throw CLIError({
        code: "UNSCOPED_EXPIRED",
        message: "--expired requires --organization-id, --folder-id, or --personal.",
        details:
          "The expiry lives on the workspace, and writing a workspace's metadata is a lesser permission than deleting it, so an unscoped sweep would delete on behalf of anyone able to write that metadata.",
      });
    }
    const olderThanMs = olderThan === undefined ? undefined : parseAge(olderThan);
    if (olderThanMs === 0 && !scoped) {
      throw CLIError({
        code: "UNSCOPED_ZERO_AGE",
        message: "--older-than 0s requires --organization-id, --folder-id, or --personal.",
        details:
          "Without an age check the name filter is the only guard, so the sweep must be scoped to an organization, a folder, or the personal workspaces.",
      });
    }
    const criteria: PruneCriteria = {
      nameRegexes: namePatterns.map(compileNameRegex),
      ...(olderThanMs === undefined ? {} : { olderThanMs }),
      organizationId,
      folderId,
      personal: args.personal,
      exclude: new Set(args.exclude ?? []),
    };

    await assertWritable({ profile: args.profile });
    const accessToken = await loadAccessToken({ profile: args.profile });
    const platformConfig = await loadPlatformClientConfig({ profile: args.profile });
    const client = await initOperatorClient(accessToken, platformConfig);

    const now = new Date();
    const selection = selectPruneCandidates(await fetchAllWorkspaces(client), criteria, now);

    const result: PruneResult = {
      dryRun: args["dry-run"],
      candidates: [],
      deleted: [],
      failed: [],
      skipped: {
        excluded: [],
        deleteProtection: [],
        unknownAge: [],
        notExpired: [],
        noExpiry: [],
        unreadableExpiry: [],
        expiryChanged: [],
        changed: [],
      },
    };

    if (args.expired) {
      const partition = await partitionByExpiry(client, selection.candidates, now);
      selection.candidates = partition.expired;
      for (const workspace of partition.pending) {
        result.skipped.notExpired.push(workspace.name);
      }
      for (const workspace of partition.unset) {
        result.skipped.noExpiry.push(workspace.name);
      }
      for (const { workspace, reason } of partition.unreadable) {
        result.skipped.unreadableExpiry.push(workspace.name);
        logger.warn(`Keeping ${workspace.name} (${workspace.id}): ${reason}.`);
      }
      logger.info(
        `${partition.pending.length} workspace(s) have not expired and ${partition.unset.length} record no expiry; both were kept.`,
      );
    }
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
      if (args.expired) {
        const recheck = await fetchWorkspaceExpiry(client, workspace.id, new Date());
        const state = "error" in recheck ? "unreadable" : recheck.expiry.state;
        if (state !== "expired") {
          result.skipped.expiryChanged.push(displayName);
          logger.info(
            `Skipped ${displayName} (${workspace.id}): its recorded expiry no longer selects it.`,
          );
          continue;
        }
      }
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
