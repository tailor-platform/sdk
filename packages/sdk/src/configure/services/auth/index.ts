import { type TailorDBInstance } from "../tailordb/schema";
import type {
  AuthConnectionTokenResult,
  AuthDefinitionBrand,
  AuthServiceInput,
  DefinedAuth,
  UserAttributeListKey,
  UserAttributeMap,
} from "#/configure/services/auth/types";
import type {
  DefinedFieldMetadata,
  FieldMetadata,
  TailorFieldType,
  TailorField,
} from "#/configure/types/field.types";

type MachineUserAttributeFields = Record<
  string,
  TailorField<DefinedFieldMetadata, unknown, FieldMetadata, TailorFieldType>
>;

type PlaceholderUser = TailorDBInstance<Record<string, never>, Record<string, never>>;
type PlaceholderAttributeMap = UserAttributeMap<PlaceholderUser>;
type PlaceholderAttributeList = UserAttributeListKey<PlaceholderUser>[];

type UserProfileAuthInput<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
  MachineUserNames extends string,
  ConnectionNames extends string = string,
> = Omit<
  AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames, undefined, ConnectionNames>,
  "userProfile" | "machineUserAttributes"
> & {
  userProfile: NonNullable<
    AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames, undefined>["userProfile"]
  >;
  machineUserAttributes?: never;
};

type MachineUserOnlyAuthInput<
  MachineUserNames extends string,
  MachineUserAttributes extends MachineUserAttributeFields,
  ConnectionNames extends string = string,
> = Omit<
  AuthServiceInput<
    PlaceholderUser,
    PlaceholderAttributeMap,
    PlaceholderAttributeList,
    MachineUserNames,
    MachineUserAttributes,
    ConnectionNames
  >,
  "userProfile" | "machineUserAttributes"
> & {
  userProfile?: never;
  machineUserAttributes: MachineUserAttributes;
};

export type {
  OIDC,
  SAML,
  IDToken,
  BuiltinIdP,
  IdProvider as IdProviderConfig,
  OAuth2ClientInput as OAuth2Client,
  SCIMAuthorization,
  SCIMAttribute,
  SCIMAttributeMapping,
  SCIMResource,
  SCIMConfig,
  TenantProvider as TenantProviderConfig,
} from "#/types/auth.generated";
export type {
  OAuth2ClientGrantType,
  SCIMAttributeType,
  BeforeLoginHookArgs,
  BeforeLoginClaims,
  FederatedIdentity,
  FederatedIdentityClaims,
  FederatedIdentityProvider,
} from "#/configure/services/auth/types";
export type {
  AuthConnectionOAuth2Config,
  AuthConnectionConfig,
} from "#/types/auth-connection.generated";
export type {
  ValueOperand,
  UsernameFieldKey,
  UserAttributeKey,
  UserAttributeListKey,
  UserAttributeMap,
  AuthConnectionTokenResult,
  AuthServiceInput,
  AuthConfig,
  AuthExternalConfig,
  AuthOwnConfig,
  DefinedAuth,
} from "#/configure/services/auth/types";

/**
 * Define an auth service for the Tailor SDK.
 * @template Name
 * @template User
 * @template AttributeMap
 * @template AttributeList
 * @template MachineUserNames
 * @param name - Auth service name
 * @param config - Auth service configuration
 * @returns Defined auth service
 */
export function defineAuth<
  const Name extends string,
  const User extends TailorDBInstance,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserNames extends string,
  const ConnectionNames extends string = string,
>(
  name: Name,
  config: UserProfileAuthInput<
    User,
    AttributeMap,
    AttributeList,
    MachineUserNames,
    ConnectionNames
  >,
): DefinedAuth<
  Name,
  UserProfileAuthInput<User, AttributeMap, AttributeList, MachineUserNames, ConnectionNames>
>;
export function defineAuth<
  const Name extends string,
  const MachineUserAttributes extends MachineUserAttributeFields,
  const MachineUserNames extends string,
  const ConnectionNames extends string = string,
>(
  name: Name,
  config: MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes, ConnectionNames>,
): DefinedAuth<
  Name,
  MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes, ConnectionNames>
>;
/* @__NO_SIDE_EFFECTS__ */
export function defineAuth<
  const Name extends string,
  const User extends TailorDBInstance,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserAttributes extends MachineUserAttributeFields,
  const MachineUserNames extends string,
  const ConnectionNames extends string = string,
>(
  name: Name,
  config:
    | UserProfileAuthInput<User, AttributeMap, AttributeList, MachineUserNames, ConnectionNames>
    | MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes, ConnectionNames>,
) {
  const result = {
    ...config,
    name,
    getConnectionToken<C extends string>(connectionName: C): Promise<AuthConnectionTokenResult> {
      return tailor.authconnection.getConnectionToken(connectionName);
    },
  } as const satisfies (
    | UserProfileAuthInput<User, AttributeMap, AttributeList, MachineUserNames>
    | MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes>
  ) & {
    name: string;
    getConnectionToken<C extends string>(connectionName: C): Promise<AuthConnectionTokenResult>;
  };

  return result as typeof result & AuthDefinitionBrand;
}
