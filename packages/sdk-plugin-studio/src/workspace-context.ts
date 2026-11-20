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
}

export interface WorkspaceContextOptions {
  initialProfile?: string;
  listProfiles: () => Promise<ProfileInfo[]>;
  store?: SelectionStore;
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
        return;
      }
      const found = (await options.listProfiles()).find((p) => p.name === profile);
      if (!found) throw new Error(`Profile "${profile}" not found`);
      selected = { profile: found.name, workspaceId: found.workspaceId };
      options.store?.save(found.name);
    },
    describe: async () => ({ profiles: await options.listProfiles(), selected: { ...selected } }),
  };
}

/**
 * CLI options that point a `tailor` command at the selected workspace. The workspace ID is passed
 * as well as the profile because `TAILOR_PLATFORM_WORKSPACE_ID` in the environment beats `-p`.
 * @param selection - The shell's current selection
 * @returns `-p <profile>` and/or `-w <id>`, or nothing when no workspace is selected
 */
export function selectionArgs(selection: WorkspaceSelection): string[] {
  return [
    ...(selection.profile ? ["-p", selection.profile] : []),
    ...(selection.workspaceId ? ["-w", selection.workspaceId] : []),
  ];
}
