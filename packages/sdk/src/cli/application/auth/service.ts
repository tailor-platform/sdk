import { IdProviderSchema } from "@/parser/service/auth";
import type { TailorDBService } from "@/cli/application/tailordb/service";
import type { AuthOwnConfig } from "@/configure/services/auth";
import type { IdProviderConfig } from "@/parser/service/auth";

export class AuthService {
  private _userProfile?: AuthOwnConfig["userProfile"] & {
    namespace: string;
  };
  private _parsedConfig: AuthOwnConfig & {
    idProvider?: IdProviderConfig;
  };

  constructor(
    public readonly config: AuthOwnConfig,
    public readonly tailorDBServices: ReadonlyArray<TailorDBService>,
    public readonly externalTailorDBNamespaces: ReadonlyArray<string>,
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

  get parsedConfig(): AuthOwnConfig & {
    idProvider?: IdProviderConfig;
  } {
    return this._parsedConfig;
  }

  /**
   * Resolves namespace for userProfile.
   *
   * Resolution priority:
   * 1. Explicit namespace in config
   * 2. Single TailorDB (regular or external) → use that namespace
   * 3. Multiple TailorDBs → search by type name (external cannot be searched)
   */
  async resolveNamespaces(): Promise<void> {
    // No userProfile defined
    if (!this.config.userProfile) {
      return;
    }

    // 1. Explicit namespace
    if (this.config.userProfile.namespace) {
      this._userProfile = {
        ...this.config.userProfile,
        namespace: this.config.userProfile.namespace,
      };
      return;
    }

    const totalNamespaceCount =
      this.tailorDBServices.length + this.externalTailorDBNamespaces.length;
    let userProfileNamespace: string | undefined;

    // 2. Single TailorDB
    if (totalNamespaceCount === 1) {
      userProfileNamespace =
        this.tailorDBServices[0]?.namespace ??
        this.externalTailorDBNamespaces[0];
    } else {
      // 3. Multiple TailorDBs
      await Promise.all(
        this.tailorDBServices.map((service) => service.loadTypes()),
      );

      const userProfileTypeName =
        typeof this.config.userProfile.type === "object" &&
        "name" in this.config.userProfile.type
          ? this.config.userProfile.type.name
          : undefined;

      if (userProfileTypeName) {
        for (const service of this.tailorDBServices) {
          const types = service.getTypes();
          if (
            Object.prototype.hasOwnProperty.call(types, userProfileTypeName)
          ) {
            userProfileNamespace = service.namespace;
            break;
          }
        }
      }

      if (!userProfileNamespace) {
        throw new Error(
          `userProfile type "${this.config.userProfile.type.name}" not found in any TailorDB namespace`,
        );
      }
    }

    this._userProfile = {
      ...this.config.userProfile,
      namespace: userProfileNamespace,
    };
  }
}
