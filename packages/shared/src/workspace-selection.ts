export interface WorkspaceSelection {
  profile?: string;
  workspaceId?: string;
}

/**
 * CLI options that point a `tailor` command at the selected profile. Only the profile is passed,
 * so the workspace is the one the profile points to when the command runs; a workspace ID read
 * when the profile was picked would go stale after `tailor profile update --workspace-id`.
 * @param selection - The shell's current selection
 * @returns `--profile=<name>`, or `--workspace-id=<id>` alone for a workspace without a profile, or nothing when nothing is selected
 */
export function selectionArgs(selection: WorkspaceSelection): string[] {
  if (selection.profile) return [`--profile=${selection.profile}`];
  return selection.workspaceId ? [`--workspace-id=${selection.workspaceId}`] : [];
}

/**
 * The environment for a `tailor` command that works against the selected profile. The shell
 * starts with the token of the startup user, the platform of the startup profile and its
 * workspace in `TAILOR_PLATFORM_TOKEN`, `TAILOR_PLATFORM_URL`,
 * `TAILOR_PLATFORM_OAUTH2_CLIENT_ID` and `TAILOR_PLATFORM_WORKSPACE_ID`. The CLI prefers that
 * token and workspace to `--profile`, and uses the platform for what the profile does not store,
 * so a command for another profile would run with the wrong user's credentials, platform or
 * workspace; the four are left out while a profile is selected.
 * @param selection - The shell's current selection
 * @param env - Environment to start from
 * @returns A copy of `env` to pass to the command, leaving the process environment untouched
 */
export function selectionEnv(
  selection: WorkspaceSelection,
  env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  if (!selection.profile) return { ...env };
  const {
    TAILOR_PLATFORM_TOKEN: _token,
    TAILOR_PLATFORM_URL: _url,
    TAILOR_PLATFORM_OAUTH2_CLIENT_ID: _clientId,
    TAILOR_PLATFORM_WORKSPACE_ID: _workspaceId,
    ...rest
  } = env;
  return rest;
}
