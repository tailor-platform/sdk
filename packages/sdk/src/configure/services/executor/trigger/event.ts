import type { ResolverConfig } from "@/configure/services/resolver/resolver";
import type { TailorDBType } from "@/configure/services/tailordb/schema";
import type { TailorActor } from "@/configure/types/actor";
import type { TailorEnv } from "@/configure/types/env";
import type { output } from "@/configure/types/helpers";
import type {
  TailorDBTrigger as ParserTailorDBTrigger,
  ResolverExecutedTrigger as ParserResolverExecutedTrigger,
  IdpUserTrigger as ParserIdpUserTrigger,
  AuthAccessTokenTrigger as ParserAuthAccessTokenTrigger,
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
  event: "created";
  rawEvent: "tailordb.type_record.created";
  newRecord: output<T>;
}

export interface RecordUpdatedArgs<T extends TailorDBType> extends RecordArgs {
  event: "updated";
  rawEvent: "tailordb.type_record.updated";
  newRecord: output<T>;
  oldRecord: output<T>;
}

export interface RecordDeletedArgs<T extends TailorDBType> extends RecordArgs {
  event: "deleted";
  rawEvent: "tailordb.type_record.deleted";
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

// IdP User Event Args
export interface IdpUserCreatedArgs extends EventArgs {
  event: "created";
  rawEvent: "idp.user.created";
  namespaceName: string;
  userId: string;
}

export interface IdpUserUpdatedArgs extends EventArgs {
  event: "updated";
  rawEvent: "idp.user.updated";
  namespaceName: string;
  userId: string;
}

export interface IdpUserDeletedArgs extends EventArgs {
  event: "deleted";
  rawEvent: "idp.user.deleted";
  namespaceName: string;
  userId: string;
}

export type IdpUserArgs = IdpUserCreatedArgs | IdpUserUpdatedArgs | IdpUserDeletedArgs;

// Auth Access Token Event Args
export interface AuthAccessTokenIssuedArgs extends EventArgs {
  event: "issued";
  rawEvent: "auth.access_token.issued";
  namespaceName: string;
  userId: string;
}

export interface AuthAccessTokenRefreshedArgs extends EventArgs {
  event: "refreshed";
  rawEvent: "auth.access_token.refreshed";
  namespaceName: string;
  userId: string;
}

export interface AuthAccessTokenRevokedArgs extends EventArgs {
  event: "revoked";
  rawEvent: "auth.access_token.revoked";
  namespaceName: string;
  userId: string;
}

export type AuthAccessTokenArgs =
  | AuthAccessTokenIssuedArgs
  | AuthAccessTokenRefreshedArgs
  | AuthAccessTokenRevokedArgs;

// ---------------------------------------------------------------------------
// TailorDB trigger types and factories
// ---------------------------------------------------------------------------

const recordEventMap = {
  created: "tailordb.type_record.created",
  updated: "tailordb.type_record.updated",
  deleted: "tailordb.type_record.deleted",
} as const;
type RecordEventMap = typeof recordEventMap;
type RecordEventKind = keyof RecordEventMap;

type RecordArgsMap<T extends TailorDBType> = {
  created: RecordCreatedArgs<T>;
  updated: RecordUpdatedArgs<T>;
  deleted: RecordDeletedArgs<T>;
};

type RecordMultiArgs<
  T extends TailorDBType,
  K extends RecordEventKind[],
> = RecordArgsMap<T>[K[number]];

export type TailorDBTrigger<Args> = ParserTailorDBTrigger & {
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
): TailorDBTrigger<RecordCreatedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "tailordb",
    events: ["tailordb.type_record.created"],
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
): TailorDBTrigger<RecordUpdatedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "tailordb",
    events: ["tailordb.type_record.updated"],
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
): TailorDBTrigger<RecordDeletedArgs<T>> {
  const { type, condition } = options;
  return {
    kind: "tailordb",
    events: ["tailordb.type_record.deleted"],
    typeName: type.name,
    condition,
    __args: {} as RecordDeletedArgs<T>,
  };
}

type RecordTriggerMultiOptions<T extends TailorDBType, K extends RecordEventKind[]> = {
  type: T;
  events: K;
  condition?: (args: RecordMultiArgs<T, K>) => boolean;
};

/**
 * Create a trigger that fires on multiple TailorDB record event types.
 * @template T
 * @template K
 * @param options - Trigger options with events array
 * @returns TailorDB record trigger
 */
export function recordTrigger<
  T extends TailorDBType,
  const K extends [RecordEventKind, ...RecordEventKind[]],
>(options: RecordTriggerMultiOptions<T, K>): TailorDBTrigger<RecordMultiArgs<T, K>> {
  const { type, events, condition } = options;
  return {
    kind: "tailordb",
    events: events.map((k) => recordEventMap[k]),
    typeName: type.name,
    condition,
    __args: {} as RecordMultiArgs<T, K>,
  };
}

// ---------------------------------------------------------------------------
// Resolver trigger
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// IdP User trigger types and factories
// ---------------------------------------------------------------------------

const idpUserEventMap = {
  created: "idp.user.created",
  updated: "idp.user.updated",
  deleted: "idp.user.deleted",
} as const;
type IdpUserEventMap = typeof idpUserEventMap;
type IdpUserEventKind = keyof IdpUserEventMap;

type IdpUserArgsMap = {
  created: IdpUserCreatedArgs;
  updated: IdpUserUpdatedArgs;
  deleted: IdpUserDeletedArgs;
};

type IdpUserMultiArgs<K extends IdpUserEventKind[]> = IdpUserArgsMap[K[number]];

export type IdpUserTrigger<Args> = ParserIdpUserTrigger & {
  __args: Args;
};

/**
 * Create a trigger that fires when an IdP user is created.
 * @returns IdP user created trigger
 */
export function idpUserCreatedTrigger(): IdpUserTrigger<IdpUserCreatedArgs> {
  return {
    kind: "idpUser",
    events: ["idp.user.created"],
    __args: {} as IdpUserCreatedArgs,
  };
}

/**
 * Create a trigger that fires when an IdP user is updated.
 * @returns IdP user updated trigger
 */
export function idpUserUpdatedTrigger(): IdpUserTrigger<IdpUserUpdatedArgs> {
  return {
    kind: "idpUser",
    events: ["idp.user.updated"],
    __args: {} as IdpUserUpdatedArgs,
  };
}

/**
 * Create a trigger that fires when an IdP user is deleted.
 * @returns IdP user deleted trigger
 */
export function idpUserDeletedTrigger(): IdpUserTrigger<IdpUserDeletedArgs> {
  return {
    kind: "idpUser",
    events: ["idp.user.deleted"],
    __args: {} as IdpUserDeletedArgs,
  };
}

type IdpUserTriggerOptions<K extends IdpUserEventKind[]> = {
  events: K;
};

/**
 * Create a trigger that fires on multiple IdP user event types.
 * @template K
 * @param options - Trigger options with events array
 * @returns IdP user trigger
 */
export function idpUserTrigger<const K extends [IdpUserEventKind, ...IdpUserEventKind[]]>(
  options: IdpUserTriggerOptions<K>,
): IdpUserTrigger<IdpUserMultiArgs<K>> {
  const { events } = options;
  return {
    kind: "idpUser",
    events: events.map((k) => idpUserEventMap[k]),
    __args: {} as IdpUserMultiArgs<K>,
  };
}

// ---------------------------------------------------------------------------
// Auth Access Token trigger types and factories
// ---------------------------------------------------------------------------

const authAccessTokenEventMap = {
  issued: "auth.access_token.issued",
  refreshed: "auth.access_token.refreshed",
  revoked: "auth.access_token.revoked",
} as const;
type AuthAccessTokenEventMap = typeof authAccessTokenEventMap;
type AuthAccessTokenEventKind = keyof AuthAccessTokenEventMap;

type AuthAccessTokenArgsMap = {
  issued: AuthAccessTokenIssuedArgs;
  refreshed: AuthAccessTokenRefreshedArgs;
  revoked: AuthAccessTokenRevokedArgs;
};

type AuthAccessTokenMultiArgs<K extends AuthAccessTokenEventKind[]> =
  AuthAccessTokenArgsMap[K[number]];

export type AuthAccessTokenTrigger<Args> = ParserAuthAccessTokenTrigger & {
  __args: Args;
};

/**
 * Create a trigger that fires when an access token is issued.
 * @returns Auth access token issued trigger
 */
export function authAccessTokenIssuedTrigger(): AuthAccessTokenTrigger<AuthAccessTokenIssuedArgs> {
  return {
    kind: "authAccessToken",
    events: ["auth.access_token.issued"],
    __args: {} as AuthAccessTokenIssuedArgs,
  };
}

/**
 * Create a trigger that fires when an access token is refreshed.
 * @returns Auth access token refreshed trigger
 */
export function authAccessTokenRefreshedTrigger(): AuthAccessTokenTrigger<AuthAccessTokenRefreshedArgs> {
  return {
    kind: "authAccessToken",
    events: ["auth.access_token.refreshed"],
    __args: {} as AuthAccessTokenRefreshedArgs,
  };
}

/**
 * Create a trigger that fires when an access token is revoked.
 * @returns Auth access token revoked trigger
 */
export function authAccessTokenRevokedTrigger(): AuthAccessTokenTrigger<AuthAccessTokenRevokedArgs> {
  return {
    kind: "authAccessToken",
    events: ["auth.access_token.revoked"],
    __args: {} as AuthAccessTokenRevokedArgs,
  };
}

type AuthAccessTokenTriggerOptions<K extends AuthAccessTokenEventKind[]> = {
  events: K;
};

/**
 * Create a trigger that fires on multiple auth access token event types.
 * @template K
 * @param options - Trigger options with events array
 * @returns Auth access token trigger
 */
export function authAccessTokenTrigger<
  const K extends [AuthAccessTokenEventKind, ...AuthAccessTokenEventKind[]],
>(options: AuthAccessTokenTriggerOptions<K>): AuthAccessTokenTrigger<AuthAccessTokenMultiArgs<K>> {
  const { events } = options;
  return {
    kind: "authAccessToken",
    events: events.map((k) => authAccessTokenEventMap[k]),
    __args: {} as AuthAccessTokenMultiArgs<K>,
  };
}
