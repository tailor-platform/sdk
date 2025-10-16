import { type SecretValue } from "@/configure/types/types";
import type { SqlClient } from "../pipeline";

// Auth types
export interface Invoker {
  AuthNamespace: string;
  MachineUserName: string;
}

// Target types
export interface GraphqlTarget {
  Kind: "graphql";
  AppName: string;
  Query: string;
  Variables?: string;
  Invoker?: Invoker;
}

export interface FunctionTarget {
  Kind: "function" | "job_function";
  Name: string;
  Variables: string;
  Invoker?: Invoker;
  fn: (args: never) => void | Promise<void>;
  dbNamespace?: string;
}

export interface WebhookHeader {
  Key: string;
  Value: string | SecretValue;
}

export interface WebhookTarget {
  Kind: "webhook";
  URL: string;
  Headers?: WebhookHeader[];
  Body?: string;
}

export type Target = WebhookTarget | GraphqlTarget | FunctionTarget;

export type FunctionArgs<Args, DB> = DB extends string
  ? Args & { client: SqlClient }
  : Args;

// Trigger types
export interface ScheduleTrigger {
  Kind: "Schedule";
  Timezone: string;
  Frequency: string;
}

type EventType =
  | {
      kind: `tailordb.type_record.${"created" | "updated" | "deleted"}`;
      typeName: string;
    }
  | {
      kind: "pipeline.resolver.executed";
      resolverName: string;
    };

export type EventTrigger = {
  Kind: "Event";
  EventType: EventType;
  Condition: string;
};
export interface IncomingWebhookTrigger {
  Kind: "IncomingWebhook";
}

export type Trigger = ScheduleTrigger | EventTrigger | IncomingWebhookTrigger;

export type WithArgs<T> = {
  _args: T;
};

export type TriggerWithArgs<Args> = Trigger & WithArgs<Args>;

export interface Executor {
  name: string;
  description?: string;
  trigger: Trigger;
  exec: Target;
}

export type ExecutorServiceConfig = { files: string[] };
export type ExecutorServiceInput = ExecutorServiceConfig;
