import type { Application } from "#/cli/services/application";
import type { GeneratorAuthInput } from "#/plugin/types";

/**
 * Build the auth input passed to generator plugins from an application's
 * auth service.
 * @param application - Application instance to read the auth service from
 * @returns Auth input for generator plugins, or undefined when the config has no auth
 */
export function getAuthInput(application: Application): GeneratorAuthInput | undefined {
  const authService = application.authService;
  if (!authService) return undefined;

  const authConfig = authService.config;
  const userProfile = authService.userProfile;
  return {
    name: authConfig.name,
    userProfile: userProfile
      ? {
          typeName: userProfile.type.name,
          namespace: userProfile.namespace,
          usernameField: userProfile.usernameField,
        }
      : undefined,
    machineUsers: authConfig.machineUsers,
    oauth2Clients: authConfig.oauth2Clients,
    idProvider: authConfig.idProvider,
  };
}
