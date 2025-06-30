import { measure } from "@/performance";
import { AuthServiceInput, IdProviderConfig } from "./types";

export class AuthService {
  constructor(public readonly config: AuthServiceInput) {}

  @measure
  toManifest() {
    return {
      Kind: "auth",
      Namespace: this.config.namespace,
      IdProviderConfigs: this.config.idProviderConfigs?.map(
        (provider: IdProviderConfig) => {
          const baseConfig = { Name: provider.Name };
          switch (provider.Config.Kind) {
            case "IDToken":
              return { ...baseConfig, IdTokenConfig: provider.Config };
            case "SAML":
              return { ...baseConfig, SamlConfig: provider.Config };
            case "OIDC":
              return { ...baseConfig, OidcConfig: provider.Config };
            default:
              throw new Error(
                `Unknown IdProviderConfig kind: ${provider.Config satisfies never}`,
              );
          }
        },
      ),
      UserProfileProvider: this.config.userProfileProvider,
      UserProfileProviderConfig: this.config.userProfileProviderConfig,
      SCIMConfig: this.config.scimConfig || null,
      TenantProvider: this.config.tenantProvider || "",
      TenantProviderConfig: this.config.tenantProviderConfig || null,
      MachineUsers: this.config.machineUsers,
      OAuth2Clients: this.config.oauth2Clients || [],
      Version: this.config.version,
    };
  }
}
