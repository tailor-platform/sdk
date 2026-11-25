import type { AuthService } from "#/cli/services/auth/service";
import type { GeneratorAuthInput } from "#/plugin/types";

/**
 * Build the auth input passed to generator plugins from an auth service.
 * @param authService - Auth service whose namespaces are resolved
 * @returns Auth input for generator plugins
 */
export function getAuthInput(authService: Readonly<AuthService>): GeneratorAuthInput {
  const authConfig = authService.config;
  const userProfile = authService.userProfile;
  return {
    name: authConfig.name,
    userProfile: userProfile
      ? {
          tableName: userProfile.type.name,
          namespace: userProfile.namespace,
          usernameField: userProfile.usernameField,
        }
      : undefined,
    machineUsers: authConfig.machineUsers,
    oauth2Clients: authConfig.oauth2Clients,
    idProvider: authConfig.idProvider,
  };
}
