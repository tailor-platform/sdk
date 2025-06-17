import { measure } from "../../performance";
import { AuthServiceInput, IdProviderConfig } from "./types";

export class AuthService {
  constructor(public readonly config: AuthServiceInput) {}

  @measure
  toManifest() {
    return {
      Kind: "auth",
      Namespace: this.config.namespace,
      IdProviderConfigs: this.config.idProviderConfigs?.map((
        provider: IdProviderConfig,
      ) => ({
        Name: provider.Name,
        Config: provider.Config,
        IdTokenConfig: provider.IdTokenConfig || provider.Config,
      })),
      UserProfileProvider: this.config.userProfileProvider,
      UserProfileProviderConfig: this.config.userProfileProviderConfig,
      SCIMConfig: this.config.scimConfig,
      TenantProvider: this.config.tenantProvider,
      TenantProviderConfig: this.config.tenantProviderConfig,
      MachineUsers: this.config.machineUsers,
      OAuth2Clients: this.config.oauth2Clients,
      Version: this.config.version,
    };
  }
}
