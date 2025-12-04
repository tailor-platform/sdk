import { type TailorDBInstance } from "../tailordb/schema";
import type {
  AuthInvoker as ParserAuthInvoker,
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

/**
 * Invoker type compatible with tailor.v1.AuthInvoker
 * - namespace: auth service name
 * - machineUserName: machine user name
 */
export type AuthInvoker<M extends string> = Omit<
  ParserAuthInvoker,
  "machineUserName"
> & {
  machineUserName: M;
};

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
      return { namespace: name, machineUserName: machineUser } as const;
    },
  } as const satisfies AuthServiceInput<
    User,
    AttributeMap,
    AttributeList,
    MachineUserNames
  > & {
    name: string;
    invoker<M extends MachineUserNames>(machineUser: M): AuthInvoker<M>;
  };

  return result as typeof result & AuthDefinitionBrand;
}

export type AuthExternalConfig = { name: string; external: true };

export type AuthOwnConfig = ReturnType<
  typeof defineAuth<string, any, any, any, string>
>;

export type AuthConfig = AuthOwnConfig | AuthExternalConfig;
