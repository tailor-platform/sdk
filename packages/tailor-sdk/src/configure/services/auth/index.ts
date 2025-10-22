import { type TailorDBType } from "../tailordb/schema";
import type {
  AuthServiceInput,
  ParseAuthConfigInput,
  UserAttributeListKey,
  UserAttributeMap,
} from "@/parser/service/auth/types";

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
  SCIMSchema,
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
  const User extends TailorDBType,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserNames extends string,
>(
  name: Name,
  config: AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames>,
) {
  return {
    ...config,
    name,
    invoker<M extends MachineUserNames>(machineUser: M) {
      return { authName: name, machineUser } as const;
    },
  } as const satisfies ParseAuthConfigInput<
    User,
    AttributeMap,
    AttributeList,
    MachineUserNames
  >;
}

export type AuthConfig = ReturnType<typeof defineAuth>;
