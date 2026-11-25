import { listProfileInfos } from "@tailor-platform/sdk/cli";

export interface WorkspaceSelection {
  profile?: string;
  workspaceId?: string;
}

export interface ProfileInfo {
  name: string;
  workspaceId: string;
}

export interface SelectionStore {
  load(): string | undefined;
  save(profile: string | null): void;
}

export interface WorkspaceContext {
  restore(): Promise<void>;
  selection(): WorkspaceSelection;
  select(profile: string | null): Promise<void>;
  describe(): Promise<{ profiles: ProfileInfo[]; selected: WorkspaceSelection }>;
  /** Call `listener` after every `select`; returns the function that stops it. */
  subscribe(listener: () => void): () => void;
}

export interface WorkspaceContextOptions {
  initialProfile?: string;
  listProfiles: () => Promise<ProfileInfo[]>;
  store?: SelectionStore;
  /** Called with what a listener threw; the other listeners still run. */
  onListenerError?: (error: unknown) => void;
}

/**
 * List the profiles of the Tailor CLI configuration.
 * @returns Profile names with their workspace IDs
 */
export async function listProfiles(): Promise<ProfileInfo[]> {
  const profiles = await listProfileInfos();
  return profiles.map(({ name, workspaceId }) => ({ name, workspaceId }));
}

/**
 * Hold the profile / workspace every tab of the shell works against.
 * @param options - Startup selection and the profile source
 * @returns The shared selection
 */
export function createWorkspaceContext(options: WorkspaceContextOptions): WorkspaceContext {
  let selected: WorkspaceSelection = {};
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) {
      try {
        listener();
      } catch (error) {
        options.onListenerError?.(error);
      }
    }
  };
  return {
    restore: async () => {
      const profiles = await options.listProfiles();
      if (options.initialProfile !== undefined) {
        const found = profiles.find((p) => p.name === options.initialProfile);
        if (!found) throw new Error(`Profile "${options.initialProfile}" not found`);
        selected = { profile: found.name, workspaceId: found.workspaceId };
        return;
      }
      const found = profiles.find((p) => p.name === options.store?.load());
      if (found) selected = { profile: found.name, workspaceId: found.workspaceId };
    },
    selection: () => ({ ...selected }),
    select: async (profile) => {
      if (profile === null) {
        selected = {};
        options.store?.save(null);
        notify();
        return;
      }
      const found = (await options.listProfiles()).find((p) => p.name === profile);
      if (!found) throw new Error(`Profile "${profile}" not found`);
      selected = { profile: found.name, workspaceId: found.workspaceId };
      options.store?.save(found.name);
      notify();
    },
    describe: async () => {
      const profiles = await options.listProfiles();
      const current = profiles.find((p) => p.name === selected.profile);
      return {
        profiles,
        selected: current
          ? { profile: current.name, workspaceId: current.workspaceId }
          : { ...selected },
      };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
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
