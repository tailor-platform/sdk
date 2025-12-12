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
  query: z.preprocess((val) => String(val), z.string()),
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

export const WorkflowOperationSchema = z.preprocess(
  (val) => {
    if (
      typeof val === "object" &&
      val !== null &&
      "workflow" in val &&
      typeof val.workflow === "object"
    ) {
      const { workflow, ...rest } = val as { workflow: { name: string } };
      return { ...rest, workflowName: workflow.name };
    }
    return val;
  },
  z.object({
    kind: z.literal("workflow"),
    workflowName: z.string(),
    args: z
      .union([z.record(z.string(), z.unknown()), functionSchema])
      .optional(),
    authInvoker: AuthInvokerSchema.optional(),
  }),
);

export const OperationSchema = z.union([
  FunctionOperationSchema,
  GqlOperationSchema,
  WebhookOperationSchema,
  WorkflowOperationSchema,
]);

export const ExecutorSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  disabled: z.boolean().optional().default(false),
  trigger: TriggerSchema,
  operation: OperationSchema,
});
