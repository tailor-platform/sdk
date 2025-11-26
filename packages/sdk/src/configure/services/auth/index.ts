import { type TailorDBInstance } from "../tailordb/schema";
import type {
  AuthServiceInput,
  UserAttributeListKey,
  UserAttributeMap,
} from "@/parser/service/auth/types";

declare const authDefinitionBrand: unique symbol;
type AuthDefinitionBrand = { readonly [authDefinitionBrand]: true };

export type {
  OIDC,
  SAML,
  IDToken,
  BuiltinIdP,
  IdProviderConfig,
  OAuth2ClientGrantType,
  OAuth2Client,
  SCIMAuthorization,
  SCIMAttributeType,
  SCIMAttribute,
  SCIMAttributeMapping,
  SCIMResource,
  SCIMConfig,
  TenantProviderConfig,
  ValueOperand,
  UsernameFieldKey,
  UserAttributeKey,
  UserAttributeListKey,
  UserAttributeMap,
  AuthServiceInput,
} from "@/parser/service/auth/types";

export function defineAuth<
  const Name extends string,
  const User extends TailorDBInstance,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserNames extends string,
>(
  name: Name,
  config: AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames>,
) {
  const result = {
    ...config,
    name,
    invoker<M extends MachineUserNames>(machineUser: M) {
      return { authName: name, machineUser } as const;
    },
  } as const satisfies AuthServiceInput<
    User,
    AttributeMap,
    AttributeList,
    MachineUserNames
  > & {
    name: string;
    invoker<M extends MachineUserNames>(
      machineUser: M,
    ): { authName: string; machineUser: M };
  };

  return result as typeof result & AuthDefinitionBrand;
}

export type AuthExternalConfig = { name: string; external: true };

export type AuthOwnConfig = ReturnType<
  typeof defineAuth<string, any, any, any, string>
>;

export type AuthConfig = AuthOwnConfig | AuthExternalConfig;
