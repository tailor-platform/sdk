import { z } from "zod";
import { AuthInvokerSchema } from "../auth";
import { functionSchema } from "../common";

export const TailorDBTriggerSchema = z.object({
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

export const ResolverExecutedTriggerSchema = z.object({
  kind: z.literal("resolverExecuted"),
  resolverName: z.string().describe("Name of the resolver to trigger on"),
  condition: functionSchema.optional().describe("Condition function to filter events"),
});

export const ScheduleTriggerSchema = z.object({
  kind: z.literal("schedule"),
  cron: z.string().describe("CRON expression for the schedule"),
  timezone: z
    .string()
    .optional()
    .default("UTC")
    .describe("Timezone for the CRON schedule (default: UTC)"),
});

export const IncomingWebhookTriggerResponseSchema = z.object({
  body: functionSchema.optional().describe("Function returning the response body"),
  statusCode: z.number().int().optional().describe("HTTP status code for the response"),
});

export const IncomingWebhookTriggerSchema = z.object({
  kind: z.literal("incomingWebhook"),
  response: IncomingWebhookTriggerResponseSchema.optional().describe("Response configuration"),
});

export const IdpUserTriggerSchema = z.object({
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

export const AuthAccessTokenTriggerSchema = z.object({
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

export const TriggerSchema = z.discriminatedUnion("kind", [
  TailorDBTriggerSchema,
  ResolverExecutedTriggerSchema,
  ScheduleTriggerSchema,
  IncomingWebhookTriggerSchema,
  IdpUserTriggerSchema,
  AuthAccessTokenTriggerSchema,
]);

export const FunctionOperationSchema = z.object({
  kind: z.enum(["function", "jobFunction"]),
  body: functionSchema.describe("Function implementation"),
  invoker: AuthInvokerSchema.optional().describe("Invoker for the function execution"),
});

export const GqlOperationSchema = z.object({
  kind: z.literal("graphql"),
  appName: z.string().optional().describe("Target application name for the GraphQL query"),
  query: z.preprocess((val) => String(val), z.string().describe("GraphQL query string")),
  variables: functionSchema.optional().describe("Function to compute GraphQL variables"),
  invoker: AuthInvokerSchema.optional().describe("Invoker for the GraphQL execution"),
});

export const WebhookOperationSchema = z.object({
  kind: z.literal("webhook"),
  url: functionSchema.describe("Function returning the webhook URL"),
  requestBody: functionSchema.optional().describe("Function to compute the request body"),
  headers: z
    .record(z.string(), z.union([z.string(), z.object({ vault: z.string(), key: z.string() })]))
    .optional()
    .describe("HTTP headers for the webhook request"),
});

export const WorkflowOperationSchema = z.preprocess(
  (val) => {
    if (
      val == null ||
      typeof val !== "object" ||
      !("workflow" in val) ||
      typeof val.workflow !== "object" ||
      val.workflow === null
    ) {
      return val;
    }

    const { workflow, ...rest } = val as { workflow: { name: string } };
    return { ...rest, workflowName: workflow.name };
  },
  z.object({
    kind: z.literal("workflow"),
    workflowName: z.string().describe("Name of the workflow to execute"),
    args: z
      .union([z.record(z.string(), z.unknown()), functionSchema])
      .optional()
      .describe("Arguments to pass to the workflow"),
    invoker: AuthInvokerSchema.optional().describe("Invoker for the workflow execution"),
  }),
);

const OperationSchema = z.union([
  FunctionOperationSchema,
  GqlOperationSchema,
  WebhookOperationSchema,
  WorkflowOperationSchema,
]);

export const ExecutorSchema = z.object({
  name: z.string().describe("Executor name"),
  description: z.string().optional().describe("Executor description"),
  disabled: z.boolean().optional().default(false).describe("Whether the executor is disabled"),
  trigger: TriggerSchema.describe("Event trigger configuration"),
  operation: OperationSchema.describe("Operation to execute when triggered"),
});
