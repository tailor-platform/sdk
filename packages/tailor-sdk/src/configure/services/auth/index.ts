import { type TailorDBType } from "../tailordb/schema";
import type { parseAuthConfig } from "@/parser/service/auth";
import type {
  AuthServiceInput,
  UserAttributeListKey,
  UserAttributeMap,
} from "@/parser/service/auth";

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
} from "@/parser/service/auth";

export function defineAuth<
  const User extends TailorDBType,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserNames extends string,
>(
  name: string,
  config: AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames>,
) {
  return {
    ...config,
    name,
    invoker(machineUser: MachineUserNames) {
      return { authName: name, machineUser } as const;
    },
  } as const satisfies Parameters<
    typeof parseAuthConfig<User, AttributeMap, AttributeList, MachineUserNames>
  >[0];
}

export type AuthConfig = ReturnType<typeof defineAuth>;
