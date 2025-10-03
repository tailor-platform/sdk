import type { TailorDBService } from "../tailordb/service";
import { type AuthConfig } from "./types";

export class AuthService {
  private _userProfile?: AuthConfig["userProfile"] & {
    namespace: string;
  };
  private _tenantProviderConfig?: AuthConfig["tenantProviderConfig"] & {
    namespace: string;
  };

  constructor(
    public readonly config: AuthConfig,
    public readonly tailorDBServices: ReadonlyArray<TailorDBService>,
  ) {}

  get userProfile() {
    return this._userProfile;
  }

  get tenantProviderConfig() {
    return this._tenantProviderConfig;
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
      this._tenantProviderConfig = this.config.tenantProviderConfig
        ? {
            ...this.config.tenantProviderConfig,
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
      typeof this.config.tenantProviderConfig?.type === "string"
        ? this.config.tenantProviderConfig.type
        : undefined;

    // Find namespaces in a single loop
    let userProfileNamespace: string | undefined;
    let tenantProviderNamespace: string | undefined;

    for (const service of this.tailorDBServices) {
      const types = service.getTypes();
      for (const fileTypes of Object.values(types)) {
        if (
          userProfileTypeName &&
          !userProfileNamespace &&
          Object.prototype.hasOwnProperty.call(fileTypes, userProfileTypeName)
        ) {
          userProfileNamespace = service.namespace;
        }
        if (
          tenantProviderTypeName &&
          !tenantProviderNamespace &&
          Object.prototype.hasOwnProperty.call(
            fileTypes,
            tenantProviderTypeName,
          )
        ) {
          tenantProviderNamespace = service.namespace;
        }
        // Early exit if both are found
        if (userProfileNamespace && tenantProviderNamespace) {
          break;
        }
      }
      if (userProfileNamespace && tenantProviderNamespace) {
        break;
      }
    }

    if (this.config.userProfile && !userProfileNamespace) {
      throw new Error(
        `userProfile type "${this.config.userProfile.type.name}" not found in any TailorDB namespace`,
      );
    }

    if (this.config.tenantProviderConfig && !tenantProviderNamespace) {
      throw new Error(
        `tenantProviderConfig type "${this.config.tenantProviderConfig.type}" not found in any TailorDB namespace`,
      );
    }

    this._userProfile = this.config.userProfile
      ? {
          ...this.config.userProfile,
          namespace: userProfileNamespace!,
        }
      : undefined;
    this._tenantProviderConfig = this.config.tenantProviderConfig
      ? {
          ...this.config.tenantProviderConfig,
          namespace: tenantProviderNamespace!,
        }
      : undefined;
  }
}
