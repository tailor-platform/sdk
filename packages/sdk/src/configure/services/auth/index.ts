import { type TailorDBInstance } from "../tailordb/schema";
import type { TailorField } from "@/configure/types/type";
import type { DefinedFieldMetadata, FieldMetadata, TailorFieldType } from "@/configure/types/types";
import type {
  AuthConnectionTokenResult,
  AuthDefinitionBrand,
  AuthServiceInput,
  DefinedAuth,
  UserAttributeListKey,
  UserAttributeMap,
} from "@/types/auth";
import type { AuthInvoker as ParserAuthInvoker } from "@/types/auth.generated";

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
} from "@/types/auth.generated";
export type { OAuth2ClientGrantType, SCIMAttributeType, BeforeLoginHookArgs } from "@/types/auth";
export type {
  AuthConnectionOAuth2Config,
  AuthConnectionConfig,
} from "@/types/auth-connection.generated";
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
} from "@/types/auth";

/**
 * Invoker type compatible with tailor.v1.AuthInvoker
 * - namespace: auth service name
 * - machineUserName: machine user name
 */
export type AuthInvoker<M extends string> = Omit<ParserAuthInvoker, "machineUserName"> & {
  machineUserName: M;
};

/**
 * Define an auth service for the Tailor SDK.
 * @template Name
 * @template User
 * @template AttributeMap
 * @template AttributeList
 * @template MachineUserNames
 * @template M
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
  UserProfileAuthInput<User, AttributeMap, AttributeList, MachineUserNames, ConnectionNames>,
  MachineUserNames
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
  MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes, ConnectionNames>,
  MachineUserNames
>;
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
    invoker<M extends MachineUserNames>(machineUser: M) {
      return { namespace: name, machineUserName: machineUser } as const;
    },
    getConnectionToken<C extends string>(connectionName: C): Promise<AuthConnectionTokenResult> {
      return tailor.authconnection.getConnectionToken(connectionName);
    },
  } as const satisfies (
    | UserProfileAuthInput<User, AttributeMap, AttributeList, MachineUserNames>
    | MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes>
  ) & {
    name: string;
    invoker<M extends MachineUserNames>(machineUser: M): AuthInvoker<M>;
    getConnectionToken<C extends string>(connectionName: C): Promise<AuthConnectionTokenResult>;
  };

  validateAuthConfig(result);

  return result as typeof result & AuthDefinitionBrand;
}

function validateAuthConfig(config: {
  userProfile?: unknown;
  machineUserAttributes?: unknown;
}): void {
  const hasUserProfile = config.userProfile !== undefined;
  const hasMachineUserAttributes = config.machineUserAttributes !== undefined;

  if (hasUserProfile && hasMachineUserAttributes) {
    throw new Error("Provide either userProfile or machineUserAttributes, not both.");
  }
}
