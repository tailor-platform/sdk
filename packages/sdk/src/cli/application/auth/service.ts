import { type TailorDBService } from "@/cli/application/tailordb/service";
import { IdProviderSchema } from "@/parser/service/auth";
import type { AuthOwnConfig } from "@/configure/services/auth";
import type { IdProviderConfig } from "@/parser/service/auth";

type UserProfile = AuthOwnConfig["userProfile"] & {
  namespace: string;
};

export type AuthService = {
  readonly config: AuthOwnConfig;
  readonly tailorDBServices: ReadonlyArray<TailorDBService>;
  readonly externalTailorDBNamespaces: ReadonlyArray<string>;
  readonly parsedConfig: AuthOwnConfig & { idProvider?: IdProviderConfig };
  readonly userProfile: UserProfile | undefined;
  resolveNamespaces: () => Promise<void>;
};

/**
 * Creates a new AuthService instance.
 * @param config - The auth configuration
 * @param tailorDBServices - The TailorDB services
 * @param externalTailorDBNamespaces - External TailorDB namespaces
 * @returns A new AuthService instance
 */
export function createAuthService(
  config: AuthOwnConfig,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  externalTailorDBNamespaces: ReadonlyArray<string>,
): AuthService {
  const parsedConfig = {
    ...config,
    idProvider: IdProviderSchema.optional().parse(config.idProvider),
  };

  let userProfile: UserProfile | undefined;

  return {
    config,
    tailorDBServices,
    externalTailorDBNamespaces,
    parsedConfig,
    get userProfile() {
      return userProfile;
    },
    resolveNamespaces: async () => {
      // No userProfile defined
      if (!config.userProfile) {
        return;
      }

      // 1. Explicit namespace
      if (config.userProfile.namespace) {
        userProfile = {
          ...config.userProfile,
          namespace: config.userProfile.namespace,
        };
        return;
      }

      const totalNamespaceCount = tailorDBServices.length + externalTailorDBNamespaces.length;
      let userProfileNamespace: string | undefined;

      // 2. Single TailorDB
      if (totalNamespaceCount === 1) {
        userProfileNamespace = tailorDBServices[0]?.namespace ?? externalTailorDBNamespaces[0];
      } else {
        // 3. Multiple TailorDBs
        await Promise.all(tailorDBServices.map((tailordb) => tailordb.loadTypes()));

        const userProfileTypeName =
          typeof config.userProfile.type === "object" && "name" in config.userProfile.type
            ? config.userProfile.type.name
            : undefined;

        if (userProfileTypeName) {
          for (const service of tailorDBServices) {
            const types = service.getTypes();
            if (Object.prototype.hasOwnProperty.call(types, userProfileTypeName)) {
              userProfileNamespace = service.namespace;
              break;
            }
          }
        }

        if (!userProfileNamespace) {
          throw new Error(
            `userProfile type "${config.userProfile.type.name}" not found in any TailorDB namespace`,
          );
        }
      }

      userProfile = {
        ...config.userProfile,
        namespace: userProfileNamespace,
      };
    },
  };
}
