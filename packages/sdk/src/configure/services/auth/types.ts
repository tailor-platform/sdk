import type { TailorDBInstance } from "#/configure/services/tailordb/types";
import type {
  DefinedFieldMetadata,
  FieldMetadata,
  TailorFieldType,
  TailorField,
} from "#/configure/types/field.types";
import type { TailorEnv } from "#/runtime/types";
// Auth configuration input types and user-field type machinery.
//
// This is a pure type module: type declarations only, no zod/schema
// references, importable type-only from any layer.
import type { AuthConnectionConfig } from "#/types/auth-connection.generated";
import type {
  AuthInvoker,
  IdProvider as IdProviderConfig,
  OAuth2Client,
  OAuth2ClientInput,
  SCIMAttribute,
  SCIMConfig,
  TenantProvider as TenantProviderConfig,
} from "#/types/auth.generated";
import type { output } from "#/types/helpers";
import type { IsAny, JsonObject, JsonValue } from "type-fest";

// Derived from generated types (zinfer inlines these literal unions)
export type OAuth2ClientGrantType = OAuth2Client["grantTypes"][number];
export type SCIMAttributeType = SCIMAttribute["type"];

export type AuthInvokerWithName<M extends string> = Omit<AuthInvoker, "machineUserName"> & {
  machineUserName: M;
};

/** Result of retrieving a connection token at runtime. */
export type AuthConnectionTokenResult = {
  access_token: string;
};

// Helper types for literal permission and auth attribute operands.
export type ValueOperand = string | boolean | string[] | boolean[];
export type AuthAttributeValue = ValueOperand | null | undefined;

// User field type helpers
type UserFieldKeys<User extends TailorDBInstance> = keyof output<User> & string;

type FieldDefined<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = User["fields"][Key] extends { _defined: infer Defined } ? Defined : never;

type FieldOutput<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
> = output<User>[Key];

type FieldIsRequired<User extends TailorDBInstance, Key extends UserFieldKeys<User>> =
  undefined extends FieldOutput<User, Key> ? false : true;

type FieldIsOfType<
  User extends TailorDBInstance,
  Key extends UserFieldKeys<User>,
  Type extends string,
> = FieldDefined<User, Key> extends { type: Type } ? true : false;

type FieldIsArray<User extends TailorDBInstance, Key extends UserFieldKeys<User>> =
  FieldDefined<User, Key> extends { array: true } ? true : false;

type FieldIsUnique<User extends TailorDBInstance, Key extends UserFieldKeys<User>> =
  FieldDefined<User, Key> extends { unique: true } ? true : false;

type FieldSupportsValueOperand<User extends TailorDBInstance, Key extends UserFieldKeys<User>> =
  FieldOutput<User, Key> extends ValueOperand | null | undefined ? true : false;

// Exported user field key types
export type UsernameFieldKey<User extends TailorDBInstance> =
  IsAny<User> extends true
    ? string
    : {
        [K in UserFieldKeys<User>]: FieldIsRequired<User, K> extends true
          ? FieldIsOfType<User, K, "string"> extends true
            ? FieldIsArray<User, K> extends true
              ? never
              : FieldIsUnique<User, K> extends true
                ? K
                : never
            : never
          : never;
      }[UserFieldKeys<User>];

export type UserAttributeKey<User extends TailorDBInstance> = {
  [K in UserFieldKeys<User>]: K extends "id"
    ? never
    : FieldSupportsValueOperand<User, K> extends true
      ? FieldIsOfType<User, K, "datetime" | "date" | "time"> extends true
        ? never
        : K
      : never;
}[UserFieldKeys<User>];

export type UserAttributeListKey<User extends TailorDBInstance> = {
  [K in UserFieldKeys<User>]: K extends "id"
    ? never
    : FieldIsOfType<User, K, "uuid"> extends true
      ? FieldIsArray<User, K> extends true
        ? never
        : K
      : never;
}[UserFieldKeys<User>];

export type UserAttributeMap<User extends TailorDBInstance> = {
  [K in UserAttributeKey<User>]?: true;
};

// Helper types for AuthServiceInput
type DisallowExtraKeys<T, Allowed extends PropertyKey> = T & {
  [K in Exclude<keyof T, Allowed>]: never;
};

type AttributeListValue<
  User extends TailorDBInstance,
  Key extends UserAttributeListKey<User>,
> = Key extends keyof output<User> ? output<User>[Key] : never;

type AttributeListToTuple<
  User extends TailorDBInstance,
  AttributeList extends readonly UserAttributeListKey<User>[],
> = {
  [Index in keyof AttributeList]: AttributeList[Index] extends UserAttributeListKey<User>
    ? AttributeListValue<User, AttributeList[Index]>
    : never;
};

type AttributeMapSelectedKeys<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
> = Extract<
  {
    [K in keyof AttributeMap]-?: undefined extends AttributeMap[K] ? never : K;
  }[keyof AttributeMap],
  UserAttributeKey<User>
>;

type UserProfile<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
> = {
  /**
   * TailorDB namespace where the user type is defined.
   *
   * Usually auto-resolved, so you don't need to specify this.
   * Required only when multiple TailorDBs exist and the type is in an external TailorDB.
   */
  namespace?: string;
  type: User;
  usernameField: UsernameFieldKey<User>;
  attributes?: DisallowExtraKeys<AttributeMap, UserAttributeKey<User>>;
  attributeList?: AttributeList;
};

type MachineUserAttributeFields = Record<
  string,
  TailorField<DefinedFieldMetadata, unknown, FieldMetadata, TailorFieldType>
>;

type TailorFieldOutputValue<Field> =
  Field extends TailorField<DefinedFieldMetadata, infer Output, FieldMetadata, TailorFieldType>
    ? Output
    : never;

type MachineUserAttributeValues<Fields extends MachineUserAttributeFields> = {
  [K in keyof Fields]: TailorFieldOutputValue<Fields[K]> extends ValueOperand | null | undefined
    ? TailorFieldOutputValue<Fields[K]>
    : never;
};

type MachineUserFromAttributes<Fields extends MachineUserAttributeFields> =
  (keyof Fields extends never
    ? { attributes?: never }
    : { attributes: DisallowExtraKeys<MachineUserAttributeValues<Fields>, keyof Fields> }) & {
    attributeList?: string[];
  };

type MachineUser<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User> = UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[] = [],
  MachineUserAttributes extends MachineUserAttributeFields | undefined = undefined,
> =
  IsAny<MachineUserAttributes> extends true
    ? IsAny<User> extends true
      ? {
          attributes: Record<string, AuthAttributeValue>;
          attributeList?: string[];
        }
      : (AttributeMapSelectedKeys<User, AttributeMap> extends never
          ? { attributes?: never }
          : {
              attributes: {
                [K in AttributeMapSelectedKeys<User, AttributeMap>]: K extends keyof output<User>
                  ? output<User>[K]
                  : never;
              } & {
                [K in Exclude<
                  keyof output<User>,
                  AttributeMapSelectedKeys<User, AttributeMap>
                >]?: never;
              };
            }) &
          ([] extends AttributeList
            ? { attributeList?: never }
            : { attributeList: AttributeListToTuple<User, AttributeList> })
    : [MachineUserAttributes] extends [MachineUserAttributeFields]
      ? MachineUserFromAttributes<MachineUserAttributes>
      : IsAny<User> extends true
        ? {
            attributes: Record<string, AuthAttributeValue>;
            attributeList?: string[];
          }
        : (AttributeMapSelectedKeys<User, AttributeMap> extends never
            ? { attributes?: never }
            : {
                attributes: {
                  [K in AttributeMapSelectedKeys<User, AttributeMap>]: K extends keyof output<User>
                    ? output<User>[K]
                    : never;
                } & {
                  [K in Exclude<
                    keyof output<User>,
                    AttributeMapSelectedKeys<User, AttributeMap>
                  >]?: never;
                };
              }) &
            ([] extends AttributeList
              ? { attributeList?: never }
              : { attributeList: AttributeListToTuple<User, AttributeList> });

/** Upstream OAuth provider that federated a login through the Built-in IdP. */
export type FederatedIdentityProvider = "google" | "microsoft";

/**
 * Profile claims forwarded from the upstream OAuth provider's ID token.
 *
 * Commonly present claims are typed; any other claim the provider issues is
 * forwarded as-is and reachable through the index signature. Availability
 * varies by provider (e.g. Microsoft does not issue `picture`).
 */
export type FederatedIdentityClaims = {
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  locale?: string;
  [claim: string]: JsonValue | undefined;
};

/**
 * The upstream identity that federated this login, populated when a user signs
 * in through a Built-in IdP OAuth provider (Google or Microsoft).
 *
 * Available on {@link BeforeLoginClaims.federated_identity}; `undefined` for
 * password logins.
 */
export type FederatedIdentity = {
  provider: FederatedIdentityProvider;
  claims: FederatedIdentityClaims;
};

/**
 * Token claims passed to the {@link BeforeLoginHook} handler. Carries the IdP's
 * own claims (e.g. `sub`, `email`) plus, for federated logins, the upstream
 * provider's profile under {@link BeforeLoginClaims.federated_identity}.
 */
export type BeforeLoginClaims = JsonObject & {
  /** Present only for federated (Google/Microsoft) logins; `undefined` for password logins. */
  federated_identity?: FederatedIdentity;
};

export type BeforeLoginHookArgs = {
  claims: BeforeLoginClaims;
  idpConfigName: string;
  /** Environment variables defined in `defineConfig({ env })`. */
  env: TailorEnv;
};

export type BeforeLoginHook<MachineUserNames extends string> = {
  handler(args: BeforeLoginHookArgs): Promise<void>;
  invoker: NoInfer<MachineUserNames>;
};

export type AuthHooks<MachineUserNames extends string> = {
  beforeLogin?: BeforeLoginHook<MachineUserNames>;
};

// Input type (before parsing) - used by configure layer
export type AuthServiceInput<
  User extends TailorDBInstance,
  AttributeMap extends UserAttributeMap<User>,
  AttributeList extends UserAttributeListKey<User>[],
  MachineUserNames extends string,
  MachineUserAttributes extends MachineUserAttributeFields | undefined =
    | MachineUserAttributeFields
    | undefined,
  ConnectionNames extends string = string,
> = {
  hooks?: AuthHooks<MachineUserNames>;
  userProfile?: UserProfile<User, AttributeMap, AttributeList>;
  machineUserAttributes?: MachineUserAttributes;
  machineUsers?: Record<
    MachineUserNames,
    MachineUser<User, AttributeMap, AttributeList, MachineUserAttributes>
  >;
  oauth2Clients?: Record<string, OAuth2ClientInput>;
  idProvider?: IdProviderConfig;
  scim?: SCIMConfig;
  tenantProvider?: TenantProviderConfig;
  connections?: Record<ConnectionNames, AuthConnectionConfig>;
  publishSessionEvents?: boolean;
};

declare const authDefinitionBrand: unique symbol;
export type AuthDefinitionBrand = { readonly [authDefinitionBrand]: true };

type ConnectionNames<Config> = Config extends { connections?: Record<infer K, unknown> }
  ? K & string
  : string;

export type DefinedAuth<Name extends string, Config, MachineUserNames extends string> = Config & {
  name: Name;
  /**
   * @deprecated Pass the machine user name directly as a string instead, e.g. `authInvoker: "machine-user-name"`.
   * Using this function pulls config-layer (Node-only) dependencies into runtime bundles.
   */
  invoker<M extends MachineUserNames>(machineUser: M): AuthInvokerWithName<M>;
  /**
   * @deprecated Use `authconnection.getConnectionToken(...)` from `@tailor-platform/sdk/runtime` instead.
   * Importing `auth` from `tailor.config.ts` into runtime files pulls config-layer (Node-only)
   * dependencies into the bundle.
   */
  getConnectionToken<C extends ConnectionNames<Config>>(
    connectionName: C,
  ): Promise<AuthConnectionTokenResult>;
} & AuthDefinitionBrand;

export type AuthExternalConfig = { name: string; external: true };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AuthServiceInputLoose = AuthServiceInput<any, any, any, string, any>;

export type AuthOwnConfig = DefinedAuth<
  string,
  // Intentionally permissive: AuthConfig is the "container" type for AppConfig.auth.
  // We want any concrete `defineAuth(...)` result to be assignable here, while the
  // strong typing remains on the `defineAuth` return type itself.
  AuthServiceInputLoose,
  string
>;

export type AuthConfig = AuthOwnConfig | AuthExternalConfig;
