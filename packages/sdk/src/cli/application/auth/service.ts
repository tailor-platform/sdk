import { IdProviderSchema } from "@/parser/service/auth";
import type { TailorDBService } from "@/cli/application/tailordb/service";
import type { AuthOwnConfig } from "@/configure/services/auth";
import type { IdProviderConfig } from "@/parser/service/auth";

export class AuthService {
  private _userProfile?: AuthOwnConfig["userProfile"] & {
    namespace: string;
  };
  private _tenantProvider?: AuthOwnConfig["tenantProvider"] & {
    namespace: string;
  };
  private _parsedConfig: AuthOwnConfig & {
    idProvider?: IdProviderConfig;
  };

  constructor(
    public readonly config: AuthOwnConfig,
    public readonly tailorDBServices: ReadonlyArray<TailorDBService>,
  ) {
    // Parse idProvider to apply default values if it exists
    this._parsedConfig = {
      ...config,
      idProvider: IdProviderSchema.optional().parse(config.idProvider),
    };
  }

  get userProfile() {
    return this._userProfile;
  }

  get tenantProvider() {
    return this._tenantProvider;
  }

  get parsedConfig(): AuthOwnConfig & {
    idProvider?: IdProviderConfig;
  } {
    return this._parsedConfig;
  }

  async resolveNamespaces(): Promise<void> {
    // Load types for all TailorDB services
    await Promise.all(
      this.tailorDBServices.map((service) => service.loadTypes()),
    );

    // Default to single namespace if only one service exists
    if (this.tailorDBServices.length === 1) {
      const singleNamespace = this.tailorDBServices[0].namespace;
      this._userProfile = this.config.userProfile
        ? {
            ...this.config.userProfile,
            namespace: singleNamespace,
          }
        : undefined;
      this._tenantProvider = this.config.tenantProvider
        ? {
            ...this.config.tenantProvider,
            namespace: singleNamespace,
          }
        : undefined;
      return;
    }

    // Extract type names to search for
    const userProfileTypeName =
      this.config.userProfile?.type &&
      typeof this.config.userProfile.type === "object" &&
      "name" in this.config.userProfile.type
        ? this.config.userProfile.type.name
        : undefined;

    const tenantProviderTypeName =
      typeof this.config.tenantProvider?.type === "string"
        ? this.config.tenantProvider.type
        : undefined;

    // Find namespaces in a single loop
    let userProfileNamespace: string | undefined;
    let tenantProviderNamespace: string | undefined;

    for (const service of this.tailorDBServices) {
      const types = service.getTypes();

      if (
        userProfileTypeName &&
        !userProfileNamespace &&
        Object.prototype.hasOwnProperty.call(types, userProfileTypeName)
      ) {
        userProfileNamespace = service.namespace;
      }
      if (
        tenantProviderTypeName &&
        !tenantProviderNamespace &&
        Object.prototype.hasOwnProperty.call(types, tenantProviderTypeName)
      ) {
        tenantProviderNamespace = service.namespace;
      }

      // Early exit if both are found
      if (userProfileNamespace && tenantProviderNamespace) {
        break;
      }
    }

    if (this.config.userProfile && !userProfileNamespace) {
      throw new Error(
        `userProfile type "${this.config.userProfile.type.name}" not found in any TailorDB namespace`,
      );
    }

    if (this.config.tenantProvider && !tenantProviderNamespace) {
      throw new Error(
        `tenantProvider type "${this.config.tenantProvider.type}" not found in any TailorDB namespace`,
      );
    }

    this._userProfile = this.config.userProfile
      ? {
          ...this.config.userProfile,
          namespace: userProfileNamespace!,
        }
      : undefined;
    this._tenantProvider = this.config.tenantProvider
      ? {
          ...this.config.tenantProvider,
          namespace: tenantProviderNamespace!,
        }
      : undefined;
  }
}
