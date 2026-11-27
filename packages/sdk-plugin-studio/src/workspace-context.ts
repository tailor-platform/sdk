import { listProfileInfos } from "@tailor-platform/sdk/cli";
import type { WorkspaceSelection } from "@tailor-platform/shared/workspace-selection";

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
  let revision = 0;
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
      const ticket = ++revision;
      if (profile === null) {
        selected = {};
        options.store?.save(null);
        notify();
        return;
      }
      const found = (await options.listProfiles()).find((p) => p.name === profile);
      if (!found) throw new Error(`Profile "${profile}" not found`);
      if (ticket !== revision) return;
      selected = { profile: found.name, workspaceId: found.workspaceId };
      options.store?.save(found.name);
      notify();
    },
    describe: async () => {
      const profiles = await options.listProfiles();
      const current = profiles.find((p) => p.name === selected.profile);
      if (current && current.workspaceId !== selected.workspaceId) {
        selected = { profile: current.name, workspaceId: current.workspaceId };
        notify();
      }
      return { profiles, selected: { ...selected } };
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
