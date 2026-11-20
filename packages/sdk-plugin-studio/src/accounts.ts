import {
  createProfile,
  listLoggedInUsers,
  listWorkspacesOfUser,
  type PlatformClientConfig,
} from "@tailor-platform/sdk/cli";
import type { Accounts } from "./shell-handler";

/**
 * The users, workspaces and profile creation of one platform. The platform is fixed when the
 * studio starts, from `TAILOR_PLATFORM_URL` and its siblings.
 * @param platform - Platform connection settings read from the environment at startup
 * @returns Account operations bound to that platform
 */
export function createAccounts(platform: PlatformClientConfig | undefined): Accounts {
  return {
    listUsers: () => listLoggedInUsers(platform),
    listWorkspaces: async (user) =>
      (await listWorkspacesOfUser(user, platform)).map(({ id, name }) => ({ id, name })),
    createProfile: async (profile) => {
      await createProfile({ ...profile, ...platform });
    },
  };
}
