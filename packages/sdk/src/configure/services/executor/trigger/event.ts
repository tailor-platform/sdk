import type { ResolverConfig } from "#/configure/services/resolver/resolver";
import type { TailorDBType } from "#/configure/services/tailordb/schema";
import type { Workflow } from "#/configure/services/workflow/workflow";
import type { IdpName } from "#/configure/types/idp-name";
import type { TailorActor, TailorEnv } from "#/runtime/types";
import type {
  TailorDBTrigger as ParserTailorDBTrigger,
  ResolverExecutedTrigger as ParserResolverExecutedTrigger,
  IdpUserTrigger as ParserIdpUserTrigger,
  AuthAccessTokenTrigger as ParserAuthAccessTokenTrigger,
  WorkflowExecutionTrigger as ParserWorkflowExecutionTrigger,
  WorkflowJobExecutionTrigger as ParserWorkflowJobExecutionTrigger,
} from "#/types/executor.generated";
import type { output } from "#/types/helpers";

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

// Workflow Execution Event Args
// Workflows are not scoped to an application namespace, so these args carry no
// `appNamespace`.
interface WorkflowExecutionEventArgs {
  workspaceId: string;
  env: TailorEnv;
  actor: TailorActor | null;
  workflowId: string;
  workflowName: string;
  workflowExecutionId: string;
}

/**
 * Discriminated union on `success` shared by the `completed` events of both
 * granularity levels.
 *
 * When `success` is false, `error` carries the failure message; narrow on
 * `success` before accessing it.
 */
type CompletedResult =
  | {
      success: true;
      error?: never;
    }
  | {
      success: false;
      error: string;
    };

export interface WorkflowExecutionStartedArgs extends WorkflowExecutionEventArgs {
  event: "started";
  rawEvent: "workflow.workflow_execution.started";
}

export type WorkflowExecutionCompletedArgs = WorkflowExecutionEventArgs & {
  event: "completed";
  rawEvent: "workflow.workflow_execution.completed";
} & CompletedResult;

export interface WorkflowExecutionRetriedArgs extends WorkflowExecutionEventArgs {
  event: "retried";
  rawEvent: "workflow.workflow_execution.retried";
  /** Number of retries already attempted for this execution. */
  retryCount: number;
  /** RFC 3339 timestamp the retry is scheduled for. */
  retryAfter: string;
}

export interface WorkflowExecutionResumedArgs extends WorkflowExecutionEventArgs {
  event: "resumed";
  rawEvent: "workflow.workflow_execution.resumed";
}

export interface WorkflowExecutionWaitStartedArgs extends WorkflowExecutionEventArgs {
  event: "wait_started";
  rawEvent: "workflow.workflow_execution.wait_started";
}

export interface WorkflowExecutionWaitResolvedArgs extends WorkflowExecutionEventArgs {
  event: "wait_resolved";
  rawEvent: "workflow.workflow_execution.wait_resolved";
}

export type WorkflowExecutionArgs =
  | WorkflowExecutionStartedArgs
  | WorkflowExecutionCompletedArgs
  | WorkflowExecutionRetriedArgs
  | WorkflowExecutionResumedArgs
  | WorkflowExecutionWaitStartedArgs
  | WorkflowExecutionWaitResolvedArgs;

// Workflow Job Execution Event Args
interface WorkflowJobExecutionEventArgs extends WorkflowExecutionEventArgs {
  workflowJobExecutionId: string;
  /** Name of the job, as passed to `createWorkflowJob({ name })`. */
  jobFunctionName: string;
  /** Name identifying the job's position in the execution stack. */
  stackedJobName: string;
}

export interface WorkflowJobExecutionStartedArgs extends WorkflowJobExecutionEventArgs {
  event: "started";
  rawEvent: "workflow.workflow_execution.job_execution.started";
}

export type WorkflowJobExecutionCompletedArgs = WorkflowJobExecutionEventArgs & {
  event: "completed";
  rawEvent: "workflow.workflow_execution.job_execution.completed";
} & CompletedResult;

export interface WorkflowJobExecutionWaitStartedArgs extends WorkflowJobExecutionEventArgs {
  event: "wait_started";
  rawEvent: "workflow.workflow_execution.job_execution.wait_started";
  /** Wait point key the job is suspended on. */
  waitKey: string;
  /** JSON-serialized payload recorded with the wait point. */
  waitPayload: string;
}

export interface WorkflowJobExecutionWaitResolvedArgs extends WorkflowJobExecutionEventArgs {
  event: "wait_resolved";
  rawEvent: "workflow.workflow_execution.job_execution.wait_resolved";
  /** Wait point key that was resolved. */
  waitKey: string;
}

export type WorkflowJobExecutionArgs =
  | WorkflowJobExecutionStartedArgs
  | WorkflowJobExecutionCompletedArgs
  | WorkflowJobExecutionWaitStartedArgs
  | WorkflowJobExecutionWaitResolvedArgs;

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

type IdpUserSingleTriggerOptions = {
  /**
   * IdP namespace name to subscribe to. Required when the project defines
   * multiple IdPs; optional when a single IdP exists. Must match an IdP name
   * declared in `defineConfig({ idp: [...] })`.
   */
  idp?: IdpName;
};

/**
 * Create a trigger that fires when an IdP user is created.
 * @param options - Trigger options
 * @param options.idp - IdP namespace name to subscribe to
 * @returns IdP user created trigger
 */
export function idpUserCreatedTrigger(
  options?: IdpUserSingleTriggerOptions,
): IdpUserTrigger<IdpUserCreatedArgs> {
  return {
    kind: "idpUser",
    events: ["idp.user.created"],
    ...(options?.idp != null ? { idp: options.idp } : {}),
    __args: {} as IdpUserCreatedArgs,
  };
}

/**
 * Create a trigger that fires when an IdP user is updated.
 * @param options - Trigger options
 * @param options.idp - IdP namespace name to subscribe to
 * @returns IdP user updated trigger
 */
export function idpUserUpdatedTrigger(
  options?: IdpUserSingleTriggerOptions,
): IdpUserTrigger<IdpUserUpdatedArgs> {
  return {
    kind: "idpUser",
    events: ["idp.user.updated"],
    ...(options?.idp != null ? { idp: options.idp } : {}),
    __args: {} as IdpUserUpdatedArgs,
  };
}

/**
 * Create a trigger that fires when an IdP user is deleted.
 * @param options - Trigger options
 * @param options.idp - IdP namespace name to subscribe to
 * @returns IdP user deleted trigger
 */
export function idpUserDeletedTrigger(
  options?: IdpUserSingleTriggerOptions,
): IdpUserTrigger<IdpUserDeletedArgs> {
  return {
    kind: "idpUser",
    events: ["idp.user.deleted"],
    ...(options?.idp != null ? { idp: options.idp } : {}),
    __args: {} as IdpUserDeletedArgs,
  };
}

type IdpUserTriggerOptions<K extends IdpUserEventKind[]> = {
  events: K;
  /**
   * IdP namespace name to subscribe to. Required when the project defines
   * multiple IdPs; optional when a single IdP exists. Must match an IdP name
   * declared in `defineConfig({ idp: [...] })`.
   */
  idp?: IdpName;
};

/**
 * Create a trigger that fires on multiple IdP user event types.
 * @template K
 * @param options - Trigger options with events array
 * @param options.events - IdP user event kinds to subscribe to
 * @param options.idp - IdP namespace name to subscribe to
 * @returns IdP user trigger
 */
export function idpUserTrigger<const K extends [IdpUserEventKind, ...IdpUserEventKind[]]>(
  options: IdpUserTriggerOptions<K>,
): IdpUserTrigger<IdpUserMultiArgs<K>> {
  const { events, idp } = options;
  return {
    kind: "idpUser",
    events: events.map((k) => idpUserEventMap[k]),
    ...(idp != null ? { idp } : {}),
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

// ---------------------------------------------------------------------------
// Workflow execution trigger types and factories
// ---------------------------------------------------------------------------

const workflowExecutionEventMap = {
  started: "workflow.workflow_execution.started",
  completed: "workflow.workflow_execution.completed",
  retried: "workflow.workflow_execution.retried",
  resumed: "workflow.workflow_execution.resumed",
  wait_started: "workflow.workflow_execution.wait_started",
  wait_resolved: "workflow.workflow_execution.wait_resolved",
} as const;
type WorkflowExecutionEventKind = keyof typeof workflowExecutionEventMap;

type WorkflowExecutionArgsMap = {
  started: WorkflowExecutionStartedArgs;
  completed: WorkflowExecutionCompletedArgs;
  retried: WorkflowExecutionRetriedArgs;
  resumed: WorkflowExecutionResumedArgs;
  wait_started: WorkflowExecutionWaitStartedArgs;
  wait_resolved: WorkflowExecutionWaitResolvedArgs;
};

type WorkflowExecutionMultiArgs<K extends WorkflowExecutionEventKind[]> =
  WorkflowExecutionArgsMap[K[number]];

export type WorkflowExecutionTrigger<Args> = ParserWorkflowExecutionTrigger & {
  __args: Args;
};

type WorkflowExecutionSingleTriggerOptions<Args> = {
  /**
   * Workflow to subscribe to. Omit to subscribe to the execution events of
   * every workflow in the workspace.
   */
  workflow?: Workflow;
  condition?: (args: Args) => boolean;
};

function workflowExecutionTriggerConfig<Args>(
  events: ParserWorkflowExecutionTrigger["events"],
  options: WorkflowExecutionSingleTriggerOptions<Args> | undefined,
): WorkflowExecutionTrigger<Args> {
  return {
    kind: "workflowExecution",
    events,
    ...(options?.workflow ? { workflowName: options.workflow.name } : {}),
    condition: options?.condition,
    __args: {} as Args,
  };
}

/**
 * Create a trigger that fires when a workflow execution starts running.
 * @param options - Trigger options
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution started trigger
 */
export function workflowExecutionStartedTrigger(
  options?: WorkflowExecutionSingleTriggerOptions<WorkflowExecutionStartedArgs>,
): WorkflowExecutionTrigger<WorkflowExecutionStartedArgs> {
  return workflowExecutionTriggerConfig(["workflow.workflow_execution.started"], options);
}

/**
 * Create a trigger that fires when a workflow execution succeeds or fails.
 * @param options - Trigger options
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution completed trigger
 */
export function workflowExecutionCompletedTrigger(
  options?: WorkflowExecutionSingleTriggerOptions<WorkflowExecutionCompletedArgs>,
): WorkflowExecutionTrigger<WorkflowExecutionCompletedArgs> {
  return workflowExecutionTriggerConfig(["workflow.workflow_execution.completed"], options);
}

/**
 * Create a trigger that fires when a workflow execution is retried by its retry policy.
 * @param options - Trigger options
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution retried trigger
 */
export function workflowExecutionRetriedTrigger(
  options?: WorkflowExecutionSingleTriggerOptions<WorkflowExecutionRetriedArgs>,
): WorkflowExecutionTrigger<WorkflowExecutionRetriedArgs> {
  return workflowExecutionTriggerConfig(["workflow.workflow_execution.retried"], options);
}

/**
 * Create a trigger that fires when a failed workflow execution is manually resumed.
 * @param options - Trigger options
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution resumed trigger
 */
export function workflowExecutionResumedTrigger(
  options?: WorkflowExecutionSingleTriggerOptions<WorkflowExecutionResumedArgs>,
): WorkflowExecutionTrigger<WorkflowExecutionResumedArgs> {
  return workflowExecutionTriggerConfig(["workflow.workflow_execution.resumed"], options);
}

/**
 * Create a trigger that fires when a workflow execution starts waiting on a wait point.
 * @param options - Trigger options
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution wait started trigger
 */
export function workflowExecutionWaitStartedTrigger(
  options?: WorkflowExecutionSingleTriggerOptions<WorkflowExecutionWaitStartedArgs>,
): WorkflowExecutionTrigger<WorkflowExecutionWaitStartedArgs> {
  return workflowExecutionTriggerConfig(["workflow.workflow_execution.wait_started"], options);
}

/**
 * Create a trigger that fires when a waiting workflow execution is released.
 * @param options - Trigger options
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution wait resolved trigger
 */
export function workflowExecutionWaitResolvedTrigger(
  options?: WorkflowExecutionSingleTriggerOptions<WorkflowExecutionWaitResolvedArgs>,
): WorkflowExecutionTrigger<WorkflowExecutionWaitResolvedArgs> {
  return workflowExecutionTriggerConfig(["workflow.workflow_execution.wait_resolved"], options);
}

type WorkflowExecutionTriggerOptions<K extends WorkflowExecutionEventKind[]> = {
  events: K;
  /**
   * Workflow to subscribe to. Omit to subscribe to the execution events of
   * every workflow in the workspace.
   */
  workflow?: Workflow;
  condition?: (args: WorkflowExecutionMultiArgs<K>) => boolean;
};

/**
 * Create a trigger that fires on multiple workflow execution event types.
 * @template K
 * @param options - Trigger options with events array
 * @param options.events - Workflow execution event kinds to subscribe to
 * @param options.workflow - Workflow to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow execution trigger
 */
export function workflowExecutionTrigger<
  const K extends [WorkflowExecutionEventKind, ...WorkflowExecutionEventKind[]],
>(
  options: WorkflowExecutionTriggerOptions<K>,
): WorkflowExecutionTrigger<WorkflowExecutionMultiArgs<K>> {
  const { events, workflow, condition } = options;
  return workflowExecutionTriggerConfig(
    events.map((k) => workflowExecutionEventMap[k]),
    { workflow, condition },
  );
}

// ---------------------------------------------------------------------------
// Workflow job execution trigger types and factories
// ---------------------------------------------------------------------------

const workflowJobExecutionEventMap = {
  started: "workflow.workflow_execution.job_execution.started",
  completed: "workflow.workflow_execution.job_execution.completed",
  wait_started: "workflow.workflow_execution.job_execution.wait_started",
  wait_resolved: "workflow.workflow_execution.job_execution.wait_resolved",
} as const;
type WorkflowJobExecutionEventKind = keyof typeof workflowJobExecutionEventMap;

type WorkflowJobExecutionArgsMap = {
  started: WorkflowJobExecutionStartedArgs;
  completed: WorkflowJobExecutionCompletedArgs;
  wait_started: WorkflowJobExecutionWaitStartedArgs;
  wait_resolved: WorkflowJobExecutionWaitResolvedArgs;
};

type WorkflowJobExecutionMultiArgs<K extends WorkflowJobExecutionEventKind[]> =
  WorkflowJobExecutionArgsMap[K[number]];

export type WorkflowJobExecutionTrigger<Args> = ParserWorkflowJobExecutionTrigger & {
  __args: Args;
};

type WorkflowJobExecutionSingleTriggerOptions<Args> = {
  /**
   * Workflow whose job executions to subscribe to. Omit to subscribe to the job
   * execution events of every workflow in the workspace.
   */
  workflow?: Workflow;
  condition?: (args: Args) => boolean;
};

function workflowJobExecutionTriggerConfig<Args>(
  events: ParserWorkflowJobExecutionTrigger["events"],
  options: WorkflowJobExecutionSingleTriggerOptions<Args> | undefined,
): WorkflowJobExecutionTrigger<Args> {
  return {
    kind: "workflowJobExecution",
    events,
    ...(options?.workflow ? { workflowName: options.workflow.name } : {}),
    condition: options?.condition,
    __args: {} as Args,
  };
}

/**
 * Create a trigger that fires when a job inside a workflow starts running.
 * @param options - Trigger options
 * @param options.workflow - Workflow whose job executions to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow job execution started trigger
 */
export function workflowJobExecutionStartedTrigger(
  options?: WorkflowJobExecutionSingleTriggerOptions<WorkflowJobExecutionStartedArgs>,
): WorkflowJobExecutionTrigger<WorkflowJobExecutionStartedArgs> {
  return workflowJobExecutionTriggerConfig(
    ["workflow.workflow_execution.job_execution.started"],
    options,
  );
}

/**
 * Create a trigger that fires when a job inside a workflow succeeds or fails.
 *
 * A job released from a wait point reports `wait_resolved` instead of
 * `completed`; subscribe to both to observe every way a job can end.
 * @param options - Trigger options
 * @param options.workflow - Workflow whose job executions to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow job execution completed trigger
 */
export function workflowJobExecutionCompletedTrigger(
  options?: WorkflowJobExecutionSingleTriggerOptions<WorkflowJobExecutionCompletedArgs>,
): WorkflowJobExecutionTrigger<WorkflowJobExecutionCompletedArgs> {
  return workflowJobExecutionTriggerConfig(
    ["workflow.workflow_execution.job_execution.completed"],
    options,
  );
}

/**
 * Create a trigger that fires when a job inside a workflow starts waiting on a wait point.
 * @param options - Trigger options
 * @param options.workflow - Workflow whose job executions to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow job execution wait started trigger
 */
export function workflowJobExecutionWaitStartedTrigger(
  options?: WorkflowJobExecutionSingleTriggerOptions<WorkflowJobExecutionWaitStartedArgs>,
): WorkflowJobExecutionTrigger<WorkflowJobExecutionWaitStartedArgs> {
  return workflowJobExecutionTriggerConfig(
    ["workflow.workflow_execution.job_execution.wait_started"],
    options,
  );
}

/**
 * Create a trigger that fires when a waiting job inside a workflow is released.
 * @param options - Trigger options
 * @param options.workflow - Workflow whose job executions to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow job execution wait resolved trigger
 */
export function workflowJobExecutionWaitResolvedTrigger(
  options?: WorkflowJobExecutionSingleTriggerOptions<WorkflowJobExecutionWaitResolvedArgs>,
): WorkflowJobExecutionTrigger<WorkflowJobExecutionWaitResolvedArgs> {
  return workflowJobExecutionTriggerConfig(
    ["workflow.workflow_execution.job_execution.wait_resolved"],
    options,
  );
}

type WorkflowJobExecutionTriggerOptions<K extends WorkflowJobExecutionEventKind[]> = {
  events: K;
  /**
   * Workflow whose job executions to subscribe to. Omit to subscribe to the job
   * execution events of every workflow in the workspace.
   */
  workflow?: Workflow;
  condition?: (args: WorkflowJobExecutionMultiArgs<K>) => boolean;
};

/**
 * Create a trigger that fires on multiple workflow job execution event types.
 * @template K
 * @param options - Trigger options with events array
 * @param options.events - Workflow job execution event kinds to subscribe to
 * @param options.workflow - Workflow whose job executions to subscribe to
 * @param options.condition - Condition function to filter events
 * @returns Workflow job execution trigger
 */
export function workflowJobExecutionTrigger<
  const K extends [WorkflowJobExecutionEventKind, ...WorkflowJobExecutionEventKind[]],
>(
  options: WorkflowJobExecutionTriggerOptions<K>,
): WorkflowJobExecutionTrigger<WorkflowJobExecutionMultiArgs<K>> {
  const { events, workflow, condition } = options;
  return workflowJobExecutionTriggerConfig(
    events.map((k) => workflowJobExecutionEventMap[k]),
    { workflow, condition },
  );
}
