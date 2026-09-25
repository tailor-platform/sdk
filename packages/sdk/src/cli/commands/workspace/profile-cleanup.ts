import { readPlatformConfig, writePlatformConfig } from "#/cli/shared/context";

/**
 * Remove local profiles that point at workspaces which no longer exist.
 * @param workspaceIds - Ids of the deleted workspaces
 * @returns Names of the removed profiles
 */
export async function removeProfilesForWorkspaces(
  workspaceIds: ReadonlySet<string>,
): Promise<string[]> {
  const pfConfig = await readPlatformConfig();
  const removed = Object.entries(pfConfig.profiles)
    .filter(([, profile]) => profile?.workspace_id && workspaceIds.has(profile.workspace_id))
    .map(([name]) => name);
  if (removed.length === 0) return removed;
  for (const name of removed) {
    delete pfConfig.profiles[name];
  }
  writePlatformConfig(pfConfig);
  return removed;
}
