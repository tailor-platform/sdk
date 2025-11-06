import { z } from "zod";

// Use `z.custom` instead of `z.function`, since `z.function` changes `toString` representation.
// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
const functionSchema = z.custom<Function>((val) => typeof val === "function");

export const InvokerSchema = z.object({
  authName: z.string(),
  machineUser: z.string(),
});

export const RecordTriggerSchema = z.object({
  kind: z.enum(["recordCreated", "recordUpdated", "recordDeleted"]),
  typeName: z.string(),
  condition: functionSchema.optional(),
});

export const ResolverExecutedTriggerSchema = z.object({
  kind: z.literal("resolverExecuted"),
  resolverName: z.string(),
  condition: functionSchema.optional(),
});

export const ScheduleTriggerSchema = z.object({
  kind: z.literal("schedule"),
  cron: z.string(),
  timezone: z.string().optional().default("UTC"),
});

export const IncomingWebhookTriggerSchema = z.object({
  kind: z.literal("incomingWebhook"),
});

export const TriggerSchema = z.discriminatedUnion("kind", [
  RecordTriggerSchema,
  ResolverExecutedTriggerSchema,
  ScheduleTriggerSchema,
  IncomingWebhookTriggerSchema,
]);

export const FunctionOperationSchema = z.object({
  kind: z.enum(["function", "jobFunction"]),
  body: functionSchema,
  invoker: InvokerSchema.optional(),
});

export const GqlOperationSchema = z.object({
  kind: z.literal("graphql"),
  appName: z.string(),
  query: z.string(),
  variables: functionSchema.optional(),
  invoker: InvokerSchema.optional(),
});

export const WebhookOperationSchema = z.object({
  kind: z.literal("webhook"),
  url: functionSchema,
  body: functionSchema.optional(),
  headers: z
    .record(
      z.string(),
      z.union([z.string(), z.object({ vault: z.string(), key: z.string() })]),
    )
    .optional(),
});

export const OperationSchema = z.discriminatedUnion("kind", [
  FunctionOperationSchema,
  GqlOperationSchema,
  WebhookOperationSchema,
]);

export const ExecutorSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  disabled: z.boolean().optional().default(false),
  trigger: TriggerSchema,
  operation: OperationSchema,
});
