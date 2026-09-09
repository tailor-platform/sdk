import { createApplyLimiter } from "#/cli/shared/apply-concurrency";
import { writeMetadataLabelsDirect, type MetadataLabelClient } from "../deploy/label";

/** Label key recording when a workspace becomes eligible for pruning. */
export const expiresAtLabelKey = "sdk-expires-at";

// Label values are `^$|^[a-z][a-z0-9_-]{0,62}$`, so the epoch seconds carry a
// lowercase prefix. Seconds rather than milliseconds keep the value short and
// match the resolution `createTime` is reported at.
const expiresAtValuePattern = /^s-(\d{1,15})$/;

/**
 * Build the TRN naming the workspace itself.
 *
 * The `:kind:name` tail every other SDK TRN carries identifies a resource
 * inside a workspace; omitting it addresses the workspace.
 * @param workspaceId - Workspace ID
 * @returns Fully-qualified TRN string
 */
export function workspaceTrn(workspaceId: string): string {
  return `trn:v1:workspace:${workspaceId}`;
}

/**
 * Encode an expiry instant as a metadata label value.
 * @param expiresAt - Instant the workspace becomes prunable
 * @returns Label value
 */
export function encodeExpiresAt(expiresAt: Date): string {
  return `s-${Math.floor(expiresAt.getTime() / 1000)}`;
}

/**
 * Decode a recorded expiry label value.
 *
 * Anything this module could not have written is rejected rather than read as
 * an expiry, so a hand-written or truncated value cannot make a workspace
 * deletable.
 * @param value - Label value read back from the platform
 * @returns The recorded instant, or undefined when the value is not one
 */
export function decodeExpiresAt(value: string | undefined): Date | undefined {
  const match = value?.match(expiresAtValuePattern);
  if (!match?.[1]) return undefined;
  const seconds = Number(match[1]);
  if (!Number.isSafeInteger(seconds)) return undefined;
  const expiresAt = new Date(seconds * 1000);
  return Number.isNaN(expiresAt.getTime()) ? undefined : expiresAt;
}

/** What a workspace's own labels say about when it may be pruned. */
export type WorkspaceExpiry =
  | { state: "expired"; expiresAt: Date }
  | { state: "pending"; expiresAt: Date }
  | { state: "unset" }
  | { state: "invalid"; value: string };

/**
 * Read a workspace's recorded expiry and compare it against a reference time.
 * @param labels - Labels stored on the workspace
 * @param now - Reference time
 * @returns The expiry state the labels describe
 */
export function readWorkspaceExpiry(
  labels: Record<string, string> | undefined,
  now: Date,
): WorkspaceExpiry {
  const value = labels?.[expiresAtLabelKey];
  if (value === undefined || value === "") return { state: "unset" };
  const expiresAt = decodeExpiresAt(value);
  if (!expiresAt) return { state: "invalid", value };
  return expiresAt.getTime() <= now.getTime()
    ? { state: "expired", expiresAt }
    : { state: "pending", expiresAt };
}

/**
 * Fetch one workspace's expiry state.
 *
 * A read that fails is reported as such rather than as an absent label: the
 * caller must not read a permission or transport error as "no expiry recorded"
 * and delete on the strength of it.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param now - Reference time
 * @returns The expiry state, or the error that prevented reading it
 */
export async function fetchWorkspaceExpiry(
  client: MetadataLabelClient,
  workspaceId: string,
  now: Date,
): Promise<{ expiry: WorkspaceExpiry } | { error: Error }> {
  try {
    const response = await client.getMetadata({ trn: workspaceTrn(workspaceId) });
    return { expiry: readWorkspaceExpiry(response.metadata?.labels, now) };
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }
}

/**
 * Record when a workspace becomes prunable.
 *
 * Goes through the read-merge-write helper so the workspace's other labels
 * survive: `SetMetadata` replaces the whole label map.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 * @param expiresAt - Instant the workspace becomes prunable
 */
export async function writeWorkspaceExpiry(
  client: MetadataLabelClient,
  workspaceId: string,
  expiresAt: Date,
): Promise<void> {
  await writeMetadataLabelsDirect(client, {
    trn: workspaceTrn(workspaceId),
    labels: { [expiresAtLabelKey]: encodeExpiresAt(expiresAt) },
  });
}

/**
 * Drop a workspace's recorded expiry, leaving its other labels in place.
 *
 * The key is removed rather than set to an empty value so nothing later reads
 * a blank expiry as a recorded one.
 * @param client - Operator client instance
 * @param workspaceId - Workspace ID
 */
export async function clearWorkspaceExpiry(
  client: MetadataLabelClient,
  workspaceId: string,
): Promise<void> {
  await writeMetadataLabelsDirect(client, {
    trn: workspaceTrn(workspaceId),
    remove: [expiresAtLabelKey],
  });
}

/** How a command reports a workspace's recorded expiry. */
export type ReportedExpiry = string | null | "invalid" | "unavailable";

/**
 * Describe an expiry state for command output.
 *
 * A state that could not be read reports as unavailable rather than as no
 * expiry, so output never implies a workspace is safe from `prune --expired`
 * when that is unknown.
 * @param result - What reading the expiry produced
 * @returns The value to report
 */
export function reportedExpiry(
  result: { expiry: WorkspaceExpiry } | { error: Error },
): ReportedExpiry {
  if ("error" in result) return "unavailable";
  switch (result.expiry.state) {
    case "unset":
      return null;
    case "invalid":
      return "invalid";
    default:
      return result.expiry.expiresAt.toISOString();
  }
}

/**
 * Read the recorded expiry of each workspace, bounded by the apply limiter.
 * @param client - Operator client instance
 * @param workspaceIds - Workspace IDs to read
 * @param now - Reference time
 * @returns Reported expiry per workspace, in the order given
 */
export async function fetchReportedExpiries(
  client: MetadataLabelClient,
  workspaceIds: readonly string[],
  now: Date,
): Promise<ReportedExpiry[]> {
  const limit = createApplyLimiter();
  return Promise.all(
    workspaceIds.map(async (workspaceId) => {
      const result = await limit(() => fetchWorkspaceExpiry(client, workspaceId, now));
      return reportedExpiry(result);
    }),
  );
}
