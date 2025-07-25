import { SecretValue } from "@/types/types";

// Common types
export type WithArgs<T = unknown> = {
  _args: T;
};
export type Args<T> = T extends WithArgs<infer U> ? U : never;

// New types for manifest/context separation
export type WithManifest<TManifest> = {
  manifest: TManifest;
};

export type WithContext<TContext> = {
  context: TContext;
};

export type ManifestAndContext<TManifest, TContext> = WithManifest<TManifest> &
  WithContext<TContext>;

// Auth types
export interface Invoker {
  AuthNamespace: string;
  MachineUserName: string;
}

// Operation types
export type OperationKind = "graphql" | "function" | "webhook";

export interface GraphqlOperation {
  Kind: "graphql";
  AppName?: string;
  Url?: string | null;
  Query: string;
  Variables?: { Expr: string };
  Invoker?: Invoker;
}

export interface FunctionOperation {
  Kind: "function";
  Name: string;
  Script?: string | null;
  ScriptPath?: string | null;
  Variables?: { Expr: string };
  Invoker?: Invoker;
}

export interface WebhookHeader {
  Key: string;
  Value?: string | SecretValue;
  RawValue?: string;
  SecretValue?: SecretValue;
}

export interface WebhookOperation {
  Kind: "webhook";
  URL: { Expr: string };
  Headers?: WebhookHeader[];
  Body?: { Expr: string };
  Secret?: SecretValue;
}

export type Operation = GraphqlOperation | FunctionOperation | WebhookOperation;

// Trigger types
export interface ScheduleTrigger {
  Kind: "Schedule";
  Timezone: string;
  Frequency: string;
}

export interface EventTrigger {
  Kind: "Event";
  EventType:
    | `tailordb.type_record.${"created" | "updated" | "deleted"}`
    | "pipeline.resolver.executed";
  Condition?: { Expr: string };
}

export interface IncomingWebhookTrigger {
  Kind: "IncomingWebhook";
}

export type Trigger = ScheduleTrigger | EventTrigger | IncomingWebhookTrigger;

// Target types (using operation types)
export type Target = WebhookOperation | GraphqlOperation | FunctionOperation;

// Context types for triggers
export type TriggerContext = { args?: unknown; type?: string };

// Context types for targets
export type TargetContext =
  | FunctionOperationContext<unknown>
  | GraphqlOperationContext
  | WebhookOperationContext;
export type FunctionOperationContext<TArgs = unknown> = {
  args: TArgs;
  fn: (args: TArgs & { client: unknown }) => void;
  dbNamespace?: string;
};
export type GraphqlOperationContext = { args: unknown };
export type WebhookOperationContext = { args: unknown };

export interface Executor<
  TTrigger extends ManifestAndContext<
    Trigger,
    TriggerContext
  > = ManifestAndContext<Trigger, TriggerContext>,
> {
  name: string;
  description?: string;
  trigger: TTrigger;
  exec: ManifestAndContext<Target, TargetWithArgs<TTrigger>>;
}

// Helper type to extract args from trigger context
type ExtractTriggerArgs<T> =
  T extends ManifestAndContext<Trigger, infer C>
    ? C extends { args: infer A }
      ? A
      : never
    : never;

// Target with args from trigger
type TargetWithArgs<TTrigger> = {
  args: ExtractTriggerArgs<TTrigger>;
  fn?: (args: ExtractTriggerArgs<TTrigger> & { client: unknown }) => void;
  dbNamespace?: string;
};

// Manifest types
export interface ExecutorManifest {
  Name: string;
  Description?: string;
  Trigger: Trigger;
  TriggerSchedule?: ScheduleTrigger;
  TriggerEvent?: EventTrigger;
  TriggerIncomingWebhook?: IncomingWebhookTrigger;
  Target: Target;
  TargetWebhook?: WebhookOperation;
  TargetTailorGraphql?: GraphqlOperation;
  TargetFunction?: FunctionOperation;
}

// Spec types
export interface Spec {
  Kind: "executor";
  Executors: ExecutorManifest[];
  Version: "v2";
}

export type ExecutorServiceConfig = { files: string[] };
export type ExecutorServiceInput = ExecutorServiceConfig;
