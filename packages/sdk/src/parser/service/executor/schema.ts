import { z } from "zod";
import { AuthInvokerSchema } from "../auth";
import { functionSchema } from "../common";

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
  authInvoker: AuthInvokerSchema.optional(),
});

export const GqlOperationSchema = z.object({
  kind: z.literal("graphql"),
  appName: z.string().optional(),
  query: z.string(),
  variables: functionSchema.optional(),
  authInvoker: AuthInvokerSchema.optional(),
});

export const WebhookOperationSchema = z.object({
  kind: z.literal("webhook"),
  url: functionSchema,
  requestBody: functionSchema.optional(),
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
