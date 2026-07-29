import { z } from "zod";
import { AuthInvokerSchema } from "../auth";
import { functionSchema } from "../common";
import type { JsonValue } from "#/types/helpers";

export const TailorDBTriggerSchema = z.strictObject({
  kind: z.literal("tailordb").describe("TailorDB record event trigger"),
  events: z
    .array(
      z.enum([
        "tailordb.type_record.created",
        "tailordb.type_record.updated",
        "tailordb.type_record.deleted",
      ]),
    )
    .min(1)
    .transform((arr) => [...new Set(arr)])
    .describe("TailorDB event types to trigger on"),
  typeName: z.string().describe("TailorDB type name to watch for events"),
  condition: functionSchema.optional().describe("Condition function to filter events"),
});

export const ResolverExecutedTriggerSchema = z.strictObject({
  kind: z.literal("resolverExecuted"),
  resolverName: z.string().describe("Name of the resolver to trigger on"),
  condition: functionSchema.optional().describe("Condition function to filter events"),
});

export const ScheduleTriggerSchema = z.strictObject({
  kind: z.literal("schedule"),
  cron: z.string().describe("CRON expression for the schedule"),
  timezone: z
    .string()
    .optional()
    .default("UTC")
    .describe("Timezone for the CRON schedule (default: UTC)"),
});

export const IncomingWebhookTriggerResponseSchema = z.strictObject({
  body: functionSchema.optional().describe("Function returning the response body"),
  statusCode: z.number().int().optional().describe("HTTP status code for the response"),
});

export const IncomingWebhookTriggerSchema = z.strictObject({
  kind: z.literal("incomingWebhook"),
  response: IncomingWebhookTriggerResponseSchema.optional().describe("Response configuration"),
});

export const IdpUserTriggerSchema = z.strictObject({
  kind: z.literal("idpUser").describe("IdP user event trigger"),
  events: z
    .array(z.enum(["idp.user.created", "idp.user.updated", "idp.user.deleted"]))
    .min(1)
    .transform((arr) => [...new Set(arr)])
    .describe("IdP user event types to trigger on"),
  idp: z
    .string()
    .optional()
    .describe(
      "IdP namespace name to subscribe to. If omitted, the project's only IdP is used; throws when multiple IdPs exist.",
    ),
});

export const AuthAccessTokenTriggerSchema = z.strictObject({
  kind: z.literal("authAccessToken").describe("Auth access token event trigger"),
  events: z
    .array(
      z.enum([
        "auth.access_token.issued",
        "auth.access_token.refreshed",
        "auth.access_token.revoked",
      ]),
    )
    .min(1)
    .transform((arr) => [...new Set(arr)])
    .describe("Auth access token event types to trigger on"),
});

const workflowNameSchema = z
  .string()
  .refine((value) => value.trim().length > 0, "Workflow name cannot be blank")
  .describe("Workflow name to subscribe to.");

export const WorkflowExecutionTriggerSchema = z.strictObject({
  kind: z.literal("workflowExecution").describe("Workflow execution event trigger"),
  events: z
    .array(
      z.enum([
        "workflow.workflow_execution.started",
        "workflow.workflow_execution.completed",
        "workflow.workflow_execution.retried",
        "workflow.workflow_execution.resumed",
        "workflow.workflow_execution.wait_started",
        "workflow.workflow_execution.wait_resolved",
      ]),
    )
    .min(1)
    .transform((arr) => [...new Set(arr)])
    .describe("Workflow execution event types to trigger on"),
  workflowName: workflowNameSchema,
  condition: functionSchema.optional().describe("Condition function to filter events"),
});

export const WorkflowJobExecutionTriggerSchema = z.strictObject({
  kind: z.literal("workflowJobExecution").describe("Workflow job execution event trigger"),
  events: z
    .array(
      z.enum([
        "workflow.workflow_execution.job_execution.started",
        "workflow.workflow_execution.job_execution.completed",
        "workflow.workflow_execution.job_execution.wait_started",
        "workflow.workflow_execution.job_execution.wait_resolved",
      ]),
    )
    .min(1)
    .transform((arr) => [...new Set(arr)])
    .describe("Workflow job execution event types to trigger on"),
  workflowName: workflowNameSchema,
  condition: functionSchema.optional().describe("Condition function to filter events"),
});

export const TriggerSchema = z.discriminatedUnion("kind", [
  TailorDBTriggerSchema,
  ResolverExecutedTriggerSchema,
  ScheduleTriggerSchema,
  IncomingWebhookTriggerSchema,
  IdpUserTriggerSchema,
  AuthAccessTokenTriggerSchema,
  WorkflowExecutionTriggerSchema,
  WorkflowJobExecutionTriggerSchema,
]);

export const FunctionOperationSchema = z.strictObject({
  kind: z.enum(["function", "jobFunction"]),
  body: functionSchema.describe("Function implementation"),
  invoker: AuthInvokerSchema.optional().describe("Invoker for the function execution"),
});

export const GqlOperationSchema = z.strictObject({
  kind: z.literal("graphql"),
  appName: z.string().optional().describe("Target application name for the GraphQL query"),
  query: z.preprocess((val) => String(val), z.string().describe("GraphQL query string")),
  variables: functionSchema.optional().describe("Function to compute GraphQL variables"),
  invoker: AuthInvokerSchema.optional().describe("Invoker for the GraphQL execution"),
});

export const WebhookOperationSchema = z.strictObject({
  kind: z.literal("webhook"),
  url: functionSchema.describe("Function returning the webhook URL"),
  requestBody: functionSchema.optional().describe("Function to compute the request body"),
  headers: z
    .record(
      z.string(),
      z.union([z.string(), z.strictObject({ vault: z.string(), key: z.string() })]),
    )
    .optional()
    .describe("HTTP headers for the webhook request"),
});

export const JsonValueSchema: z.ZodType<JsonValue, JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const WorkflowInputSchema: z.ZodType<
  Exclude<JsonValue, null>,
  Exclude<JsonValue, null>
> = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(JsonValueSchema),
  z.record(z.string(), JsonValueSchema),
]);

export const WorkflowOperationArgsSchema = z
  .union([WorkflowInputSchema, functionSchema])
  .describe("Arguments to pass to the workflow");

const workflowOperationShape = {
  kind: z.literal("workflow"),
  args: WorkflowOperationArgsSchema.optional(),
  invoker: AuthInvokerSchema.optional().describe("Invoker for the workflow execution"),
};

const WorkflowOperationByNameSchema = z.strictObject({
  ...workflowOperationShape,
  workflowName: z.string().describe("Name of the workflow to execute"),
  workflow: z.never().optional(),
});

const WorkflowOperationByReferenceSchema = z
  .strictObject({
    ...workflowOperationShape,
    workflow: z.looseObject({ name: z.string() }),
    workflowName: z.string().optional(),
  })
  .transform(({ workflow, ...operation }) => ({
    ...operation,
    workflowName: workflow.name,
  }));

export const WorkflowOperationSchema = z.union([
  WorkflowOperationByReferenceSchema,
  WorkflowOperationByNameSchema,
]);

export const OperationSchema = z.union([
  FunctionOperationSchema,
  GqlOperationSchema,
  WebhookOperationSchema,
  WorkflowOperationSchema,
]);

export const ExecutorSchema = z.strictObject({
  name: z.string().describe("Executor name"),
  description: z.string().optional().describe("Executor description"),
  disabled: z.boolean().optional().default(false).describe("Whether the executor is disabled"),
  trigger: TriggerSchema.describe("Event trigger configuration"),
  operation: OperationSchema.describe("Operation to execute when triggered"),
});
