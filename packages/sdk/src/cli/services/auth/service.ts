import { type TailorDBService } from "#src/cli/services/tailordb/service";
import { type AuthConfigSchema } from "#src/parser/service/auth/index";
import { assertDefined } from "#src/utils/assert";
import type { AuthConnectionConfig } from "#src/types/auth-connection.generated";
import type { z } from "zod";

/**
 * Auth config after `AuthConfigSchema.parse`. The Zod `.brand("AuthConfig")` makes
 * this type inhabitable only by parse output, so `createAuthService` can only be
 * called with a validated/transformed config (e.g. token lifetimes as Duration).
 * Passing a raw, unparsed config is a compile error.
 */
type ParsedAuthConfig = z.output<typeof AuthConfigSchema>;

type UserProfile = NonNullable<ParsedAuthConfig["userProfile"]> & {
  namespace: string;
};

export type AuthService = {
  readonly config: ParsedAuthConfig;
  readonly tailorDBServices: ReadonlyArray<TailorDBService>;
  readonly externalTailorDBNamespaces: ReadonlyArray<string>;
  readonly connections: Readonly<Record<string, AuthConnectionConfig>>;
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
  config: ParsedAuthConfig,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  externalTailorDBNamespaces: ReadonlyArray<string>,
): AuthService {
  const connections: Record<string, AuthConnectionConfig> = config.connections
    ? { ...config.connections }
    : {};

  let userProfile: UserProfile | undefined;

  return {
    config,
    tailorDBServices,
    externalTailorDBNamespaces,
    connections,
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
        userProfileNamespace =
          tailorDBServices[0]?.namespace ??
          assertDefined(externalTailorDBNamespaces[0], "external TailorDB namespace missing");
      } else {
        // 3. Multiple TailorDBs
        await Promise.all(tailorDBServices.map((tailordb) => tailordb.loadTypes()));

        const userProfileTypeName =
          typeof config.userProfile.type === "object" && "name" in config.userProfile.type
            ? config.userProfile.type.name
            : undefined;

        if (userProfileTypeName) {
          for (const service of tailorDBServices) {
            const types = service.types;
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
