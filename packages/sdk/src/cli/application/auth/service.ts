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

  async resolveNamespaces(): Promise<void> {
    if (!this.config.userProfile) {
      return;
    }

    if (this.config.userProfile.namespace) {
      this._userProfile = {
        ...this.config.userProfile,
        namespace: this.config.userProfile.namespace,
      };
      return;
    }

    await Promise.all(
      this.tailorDBServices.map((service) => service.loadTypes()),
    );

    let userProfileNamespace: string | undefined;

    if (this.tailorDBServices.length === 1) {
      userProfileNamespace = this.tailorDBServices[0].namespace;
    } else {
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
