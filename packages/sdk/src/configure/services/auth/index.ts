import { type TailorDBInstance } from "../tailordb/schema";
import type { TailorField } from "@/configure/types/type";
import type { DefinedFieldMetadata, FieldMetadata, TailorFieldType } from "@/configure/types/types";
import type {
  AuthInvoker as ParserAuthInvoker,
  AuthServiceInput,
  UserAttributeListKey,
  UserAttributeMap,
} from "@/parser/service/auth/types";

declare const authDefinitionBrand: unique symbol;
type AuthDefinitionBrand = { readonly [authDefinitionBrand]: true };

type MachineUserAttributeFields = Record<
  string,
  TailorField<DefinedFieldMetadata, unknown, FieldMetadata, TailorFieldType>
>;

type PlaceholderUser = TailorDBInstance<Record<string, never>, Record<string, never>>;
type PlaceholderAttributeMap = UserAttributeMap<PlaceholderUser>;
type PlaceholderAttributeList = UserAttributeListKey<PlaceholderUser>[];

type MachineUserOnlyAuthInput<
  MachineUserNames extends string,
  MachineUserAttributes extends MachineUserAttributeFields | undefined = undefined,
> = Omit<
  AuthServiceInput<
    PlaceholderUser,
    PlaceholderAttributeMap,
    PlaceholderAttributeList,
    MachineUserNames,
    MachineUserAttributes
  >,
  "userProfile"
> & {
  userProfile?: never;
};

type DefinedAuth<Name extends string, Config, MachineUserNames extends string> = Config & {
  name: Name;
  invoker<M extends MachineUserNames>(machineUser: M): AuthInvoker<M>;
} & AuthDefinitionBrand;

export type {
  OIDC,
  SAML,
  IDToken,
  BuiltinIdP,
  IdProviderConfig,
  OAuth2ClientGrantType,
  OAuth2ClientInput as OAuth2Client,
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
  const MachineUserAttributes extends MachineUserAttributeFields | undefined,
  const MachineUserNames extends string,
>(
  name: Name,
  config: AuthServiceInput<
    User,
    AttributeMap,
    AttributeList,
    MachineUserNames,
    MachineUserAttributes
  >,
): DefinedAuth<
  Name,
  AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames, MachineUserAttributes>,
  MachineUserNames
>;
export function defineAuth<
  const Name extends string,
  const MachineUserAttributes extends MachineUserAttributeFields | undefined,
  const MachineUserNames extends string,
>(
  name: Name,
  config: MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes>,
): DefinedAuth<
  Name,
  MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes>,
  MachineUserNames
>;
export function defineAuth<
  const Name extends string,
  const User extends TailorDBInstance,
  const AttributeMap extends UserAttributeMap<User>,
  const AttributeList extends UserAttributeListKey<User>[],
  const MachineUserAttributes extends MachineUserAttributeFields | undefined,
  const MachineUserNames extends string,
>(
  name: Name,
  config:
    | AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames, MachineUserAttributes>
    | MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes>,
) {
  const result = {
    ...config,
    name,
    invoker<M extends MachineUserNames>(machineUser: M) {
      return { namespace: name, machineUserName: machineUser } as const;
    },
  } as const satisfies (
    | AuthServiceInput<User, AttributeMap, AttributeList, MachineUserNames, MachineUserAttributes>
    | MachineUserOnlyAuthInput<MachineUserNames, MachineUserAttributes>
  ) & {
    name: string;
    invoker<M extends MachineUserNames>(machineUser: M): AuthInvoker<M>;
  };

  return result as typeof result & AuthDefinitionBrand;
}

export type AuthExternalConfig = { name: string; external: true };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthServiceInputLoose = AuthServiceInput<any, any, any, string, any>;

export type AuthOwnConfig = DefinedAuth<
  string,
  // Intentionally permissive: AuthConfig is the “container” type for AppConfig.auth.
  // We want any concrete `defineAuth(...)` result to be assignable here, while the
  // strong typing remains on the `defineAuth` return type itself.
  AuthServiceInputLoose,
  string
>;

export type AuthConfig = AuthOwnConfig | AuthExternalConfig;
