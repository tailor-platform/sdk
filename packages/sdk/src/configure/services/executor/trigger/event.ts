import type { ResolverConfig } from "@/configure/services/resolver/resolver";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { TailorActor } from "@/configure/types/actor";
import type { TailorEnv } from "@/configure/types/env";
import type { output } from "@/configure/types/helpers";
import type {
  RecordTrigger as ParserRecordTrigger,
  ResolverExecutedTrigger as ParserResolverExecutedTrigger,
  IdpUserTrigger as ParserIdpUserTrigger,
  AuthAccessTokenTrigger as ParserAuthAccessTokenTrigger,
  MultiRecordTrigger as ParserMultiRecordTrigger,
  MultiIdpUserTrigger as ParserMultiIdpUserTrigger,
  MultiAuthAccessTokenTrigger as ParserMultiAuthAccessTokenTrigger,
} from "@/types/executor.generated";

interface EventArgs {
  workspaceId: string;
  appNamespace: string;
  env: TailorEnv;
  actor: TailorActor | null;
}

interface RecordArgs extends EventArgs {
  typeName: string;
}

export interface RecordCreatedArgs<T extends TailorDBType> extends RecordArgs {
  kind: "tailordb.type_record.created";
  newRecord: output<T>;
}

export interface RecordUpdatedArgs<T extends TailorDBType> extends RecordArgs {
  kind: "tailordb.type_record.updated";
  newRecord: output<T>;
  oldRecord: output<T>;
}

export interface RecordDeletedArgs<T extends TailorDBType> extends RecordArgs {
  kind: "tailordb.type_record.deleted";
  oldRecord: output<T>;
}

/**
 * Args for resolverExecutedTrigger. This is a discriminated union on `success`.
 *
 * When `success` is true, `result` contains the resolver output and `error` is never.
 * When `success` is false, `error` contains the error message and `result` is never.
 *
 * Narrow on `success` to safely access either `result` or `error`.
 * @example
 * body: async (args) => {
 *   if (args.success) {
 *     console.log(args.result);
 *   } else {
 *     console.error(args.error);
 *   }
 * }
 */
export type ResolverExecutedArgs<R extends ResolverConfig> = EventArgs & {
  resolverName: string;
} & (
    | {
        success: true;
        result: output<R["output"]>;
        error?: never;
      }
    | {
        success: false;
        result?: never;
        error: string;
      }
  );

export type RecordTrigger<Args> = ParserRecordTrigger & {
  __args: Args;
};

type RecordTriggerOptions<T extends TailorDBType, Args> = {
  type: T;
  condition?: (args: Args) => boolean;
};

/**
 * Create a trigger that fires when a TailorDB record is created.
 * @template T
 * @param options - Trigger options
 * @returns Record created trigger
 */
export function recordCreatedTrigger<T extends TailorDBType>(
  options: RecordTriggerOptions<T, RecordCreatedArgs<T>>,
): RecordTrigger<RecordCreatedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "recordCreated",
    typeName: type.name,
    condition,
    __args: {} as RecordCreatedArgs<T>,
  };
}

/**
 * Create a trigger that fires when a TailorDB record is updated.
 * @template T
 * @param options - Trigger options
 * @returns Record updated trigger
 */
export function recordUpdatedTrigger<T extends TailorDBType>(
  options: RecordTriggerOptions<T, RecordUpdatedArgs<T>>,
): RecordTrigger<RecordUpdatedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "recordUpdated",
    typeName: type.name,
    condition,
    __args: {} as RecordUpdatedArgs<T>,
  };
}

/**
 * Create a trigger that fires when a TailorDB record is deleted.
 * @template T
 * @param options - Trigger options
 * @returns Record deleted trigger
 */
export function recordDeletedTrigger<T extends TailorDBType>(
  options: RecordTriggerOptions<T, RecordDeletedArgs<T>>,
): RecordTrigger<RecordDeletedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "recordDeleted",
    typeName: type.name,
    condition,
    __args: {} as RecordDeletedArgs<T>,
  };
}

export type ResolverExecutedTrigger<Args> = ParserResolverExecutedTrigger & {
  __args: Args;
};

type ResolverExecutedTriggerOptions<R extends ResolverConfig> = {
  resolver: R;
  condition?: (args: ResolverExecutedArgs<R>) => boolean;
};

/**
 * Create a trigger that fires when a resolver is executed.
 * @template R
 * @param options - Trigger options
 * @returns Resolver executed trigger
 */
export function resolverExecutedTrigger<R extends ResolverConfig>(
  options: ResolverExecutedTriggerOptions<R>,
): ResolverExecutedTrigger<ResolverExecutedArgs<R>> {
  const { resolver, condition } = options;
  return {
    kind: "resolverExecuted",
    resolverName: resolver.name,
    condition,
    __args: {} as ResolverExecutedArgs<R>,
  };
}

// IdP User Event Triggers
export interface IdpUserCreatedArgs extends EventArgs {
  kind: "idp.user.created";
  namespaceName: string;
  userId: string;
}

export interface IdpUserUpdatedArgs extends EventArgs {
  kind: "idp.user.updated";
  namespaceName: string;
  userId: string;
}

export interface IdpUserDeletedArgs extends EventArgs {
  kind: "idp.user.deleted";
  namespaceName: string;
  userId: string;
}

export type IdpUserArgs = IdpUserCreatedArgs | IdpUserUpdatedArgs | IdpUserDeletedArgs;

export type IdpUserTrigger<Args> = ParserIdpUserTrigger & {
  __args: Args;
};

/**
 * Create a trigger that fires when an IdP user is created.
 * @returns IdP user created trigger
 */
export function idpUserCreatedTrigger(): IdpUserTrigger<IdpUserCreatedArgs> {
  return {
    kind: "idpUserCreated",
    __args: {} as IdpUserCreatedArgs,
  };
}

/**
 * Create a trigger that fires when an IdP user is updated.
 * @returns IdP user updated trigger
 */
export function idpUserUpdatedTrigger(): IdpUserTrigger<IdpUserUpdatedArgs> {
  return {
    kind: "idpUserUpdated",
    __args: {} as IdpUserUpdatedArgs,
  };
}

/**
 * Create a trigger that fires when an IdP user is deleted.
 * @returns IdP user deleted trigger
 */
export function idpUserDeletedTrigger(): IdpUserTrigger<IdpUserDeletedArgs> {
  return {
    kind: "idpUserDeleted",
    __args: {} as IdpUserDeletedArgs,
  };
}

// Auth Access Token Event Triggers
export interface AuthAccessTokenIssuedArgs extends EventArgs {
  kind: "auth.access_token.issued";
  namespaceName: string;
  userId: string;
}

export interface AuthAccessTokenRefreshedArgs extends EventArgs {
  kind: "auth.access_token.refreshed";
  namespaceName: string;
  userId: string;
}

export interface AuthAccessTokenRevokedArgs extends EventArgs {
  kind: "auth.access_token.revoked";
  namespaceName: string;
  userId: string;
}

export type AuthAccessTokenArgs =
  | AuthAccessTokenIssuedArgs
  | AuthAccessTokenRefreshedArgs
  | AuthAccessTokenRevokedArgs;

export type AuthAccessTokenTrigger<Args> = ParserAuthAccessTokenTrigger & {
  __args: Args;
};

/**
 * Create a trigger that fires when an access token is issued.
 * @returns Auth access token issued trigger
 */
export function authAccessTokenIssuedTrigger(): AuthAccessTokenTrigger<AuthAccessTokenIssuedArgs> {
  return {
    kind: "authAccessTokenIssued",
    __args: {} as AuthAccessTokenIssuedArgs,
  };
}

/**
 * Create a trigger that fires when an access token is refreshed.
 * @returns Auth access token refreshed trigger
 */
export function authAccessTokenRefreshedTrigger(): AuthAccessTokenTrigger<AuthAccessTokenRefreshedArgs> {
  return {
    kind: "authAccessTokenRefreshed",
    __args: {} as AuthAccessTokenRefreshedArgs,
  };
}

/**
 * Create a trigger that fires when an access token is revoked.
 * @returns Auth access token revoked trigger
 */
export function authAccessTokenRevokedTrigger(): AuthAccessTokenTrigger<AuthAccessTokenRevokedArgs> {
  return {
    kind: "authAccessTokenRevoked",
    __args: {} as AuthAccessTokenRevokedArgs,
  };
}

// ---------------------------------------------------------------------------
// Multi-event trigger factories
// ---------------------------------------------------------------------------

// Record multi-event trigger
const recordKindMap = {
  created: "recordCreated",
  updated: "recordUpdated",
  deleted: "recordDeleted",
} as const;
type RecordKindMap = typeof recordKindMap;
type RecordEventKind = keyof RecordKindMap;

type RecordArgsMap<T extends TailorDBType> = {
  created: RecordCreatedArgs<T>;
  updated: RecordUpdatedArgs<T>;
  deleted: RecordDeletedArgs<T>;
};

type RecordMultiArgs<
  T extends TailorDBType,
  K extends RecordEventKind[],
> = RecordArgsMap<T>[K[number]];

export type MultiRecordTrigger<Args> = ParserMultiRecordTrigger & {
  __args: Args;
};

type RecordTriggerMultiOptions<T extends TailorDBType, K extends RecordEventKind[]> = {
  type: T;
  kinds: K;
  condition?: (args: RecordMultiArgs<T, K>) => boolean;
};

/**
 * Create a trigger that fires on multiple record event types.
 * @template T
 * @template K
 * @param options - Trigger options with kinds array
 * @returns Multi-event record trigger
 */
export function recordTrigger<
  T extends TailorDBType,
  const K extends [RecordEventKind, ...RecordEventKind[]],
>(options: RecordTriggerMultiOptions<T, K>): MultiRecordTrigger<RecordMultiArgs<T, K>> {
  const { type, kinds, condition } = options;
  return {
    kind: "record",
    kinds: kinds.map((k) => recordKindMap[k]),
    typeName: type.name,
    condition,
    __args: {} as RecordMultiArgs<T, K>,
  };
}

// IdP User multi-event trigger
const idpUserKindMap = {
  created: "idpUserCreated",
  updated: "idpUserUpdated",
  deleted: "idpUserDeleted",
} as const;
type IdpUserKindMap = typeof idpUserKindMap;
type IdpUserEventKind = keyof IdpUserKindMap;

type IdpUserArgsMap = {
  created: IdpUserCreatedArgs;
  updated: IdpUserUpdatedArgs;
  deleted: IdpUserDeletedArgs;
};

type IdpUserMultiArgs<K extends IdpUserEventKind[]> = IdpUserArgsMap[K[number]];

export type MultiIdpUserTrigger<Args> = ParserMultiIdpUserTrigger & {
  __args: Args;
};

type IdpUserTriggerOptions<K extends IdpUserEventKind[]> = {
  kinds: K;
};

/**
 * Create a trigger that fires on multiple IdP user event types.
 * @template K
 * @param options - Trigger options with kinds array
 * @returns Multi-event IdP user trigger
 */
export function idpUserTrigger<const K extends [IdpUserEventKind, ...IdpUserEventKind[]]>(
  options: IdpUserTriggerOptions<K>,
): MultiIdpUserTrigger<IdpUserMultiArgs<K>> {
  const { kinds } = options;
  return {
    kind: "idpUser",
    kinds: kinds.map((k) => idpUserKindMap[k]),
    __args: {} as IdpUserMultiArgs<K>,
  };
}

// Auth Access Token multi-event trigger
const authAccessTokenKindMap = {
  issued: "authAccessTokenIssued",
  refreshed: "authAccessTokenRefreshed",
  revoked: "authAccessTokenRevoked",
} as const;
type AuthAccessTokenKindMap = typeof authAccessTokenKindMap;
type AuthAccessTokenEventKind = keyof AuthAccessTokenKindMap;

type AuthAccessTokenArgsMap = {
  issued: AuthAccessTokenIssuedArgs;
  refreshed: AuthAccessTokenRefreshedArgs;
  revoked: AuthAccessTokenRevokedArgs;
};

type AuthAccessTokenMultiArgs<K extends AuthAccessTokenEventKind[]> =
  AuthAccessTokenArgsMap[K[number]];

export type MultiAuthAccessTokenTrigger<Args> = ParserMultiAuthAccessTokenTrigger & {
  __args: Args;
};

type AuthAccessTokenTriggerOptions<K extends AuthAccessTokenEventKind[]> = {
  kinds: K;
};

/**
 * Create a trigger that fires on multiple auth access token event types.
 * @template K
 * @param options - Trigger options with kinds array
 * @returns Multi-event auth access token trigger
 */
export function authAccessTokenTrigger<
  const K extends [AuthAccessTokenEventKind, ...AuthAccessTokenEventKind[]],
>(
  options: AuthAccessTokenTriggerOptions<K>,
): MultiAuthAccessTokenTrigger<AuthAccessTokenMultiArgs<K>> {
  const { kinds } = options;
  return {
    kind: "authAccessToken",
    kinds: kinds.map((k) => authAccessTokenKindMap[k]),
    __args: {} as AuthAccessTokenMultiArgs<K>,
  };
}
