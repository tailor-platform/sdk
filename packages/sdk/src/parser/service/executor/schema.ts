import * as v from "valibot";
import { AuthInvokerSchema } from "../auth";
import { functionSchema } from "../common";
import type { JsonValue } from "#/types/helpers";

export const TailorDBTriggerSchema = v.strictObject({
  kind: v.pipe(v.literal("tailordb"), v.description("TailorDB record event trigger")),
  events: v.pipe(
    v.array(
      v.picklist([
        "tailordb.type_record.created",
        "tailordb.type_record.updated",
        "tailordb.type_record.deleted",
      ]),
    ),
    v.minLength(1),
    v.transform((arr) => [...new Set(arr)]),
    v.description("TailorDB event types to trigger on"),
  ),
  typeName: v.pipe(v.string(), v.description("TailorDB table name to watch for events")),
  condition: v.optional(
    v.pipe(functionSchema, v.description("Condition function to filter events")),
  ),
});

export const ResolverExecutedTriggerSchema = v.strictObject({
  kind: v.literal("resolverExecuted"),
  resolverName: v.pipe(v.string(), v.description("Name of the resolver to trigger on")),
  condition: v.optional(
    v.pipe(functionSchema, v.description("Condition function to filter events")),
  ),
});

export const ScheduleTriggerSchema = v.strictObject({
  kind: v.literal("schedule"),
  cron: v.pipe(v.string(), v.description("CRON expression for the schedule")),
  timezone: v.optional(
    v.pipe(v.string(), v.description("Timezone for the CRON schedule (default: UTC)")),
    "UTC",
  ),
});

export const IncomingWebhookTriggerResponseSchema = v.strictObject({
  body: v.optional(v.pipe(functionSchema, v.description("Function returning the response body"))),
  statusCode: v.optional(
    v.pipe(v.number(), v.integer(), v.description("HTTP status code for the response")),
  ),
});

export const IncomingWebhookTriggerSchema = v.strictObject({
  kind: v.literal("incomingWebhook"),
  response: v.optional(
    v.pipe(IncomingWebhookTriggerResponseSchema, v.description("Response configuration")),
  ),
});

export const IdpUserTriggerSchema = v.strictObject({
  kind: v.pipe(v.literal("idpUser"), v.description("IdP user event trigger")),
  events: v.pipe(
    v.array(v.picklist(["idp.user.created", "idp.user.updated", "idp.user.deleted"])),
    ),
    v.minLength(1),
    v.transform((arr) => [...new Set(arr)]),
    v.description("TailorDB event types to trigger on"),
  ),
  typeName: v.pipe(v.string(), v.description("TailorDB type name to watch for events")),
  condition: v.optional(
    v.pipe(functionSchema, v.description("Condition function to filter events")),
  ),
});

export const ResolverExecutedTriggerSchema = v.strictObject({
  kind: v.literal("resolverExecuted"),
  resolverName: v.pipe(v.string(), v.description("Name of the resolver to trigger on")),
  condition: v.optional(
    v.pipe(functionSchema, v.description("Condition function to filter events")),
  ),
});

export const ScheduleTriggerSchema = v.strictObject({
  kind: v.literal("schedule"),
  cron: v.pipe(v.string(), v.description("CRON expression for the schedule")),
  timezone: v.optional(
    v.pipe(v.string(), v.description("Timezone for the CRON schedule (default: UTC)")),
    "UTC",
  ),
});

export const IncomingWebhookTriggerResponseSchema = v.strictObject({
  body: v.optional(v.pipe(functionSchema, v.description("Function returning the response body"))),
  statusCode: v.optional(
    v.pipe(v.number(), v.integer(), v.description("HTTP status code for the response")),
  ),
});

export const IncomingWebhookTriggerSchema = v.strictObject({
  kind: v.literal("incomingWebhook"),
  response: v.optional(
    v.pipe(IncomingWebhookTriggerResponseSchema, v.description("Response configuration")),
  ),
});

export const IdpUserTriggerSchema = v.strictObject({
  kind: v.pipe(v.literal("idpUser"), v.description("IdP user event trigger")),
  events: v.pipe(
    v.array(v.picklist(["idp.user.created", "idp.user.updated", "idp.user.deleted"])),
    v.minLength(1),
    v.transform((arr) => [...new Set(arr)]),
    v.description("IdP user event types to trigger on"),
  ),
  idp: v.optional(
    v.pipe(
      v.string(),
      v.description(
        "IdP namespace name to subscribe to. If omitted, the project's only IdP is used; throws when multiple IdPs exist.",
      ),
    ),
  ),
});

export const AuthAccessTokenTriggerSchema = v.strictObject({
  kind: v.pipe(v.literal("authAccessToken"), v.description("Auth access token event trigger")),
  events: v.pipe(
    v.array(
      v.picklist([
        "auth.access_token.issued",
        "auth.access_token.refreshed",
        "auth.access_token.revoked",
      ]),
    ),
    v.minLength(1),
    v.transform((arr) => [...new Set(arr)]),
    v.description("Auth access token event types to trigger on"),
  ),
});

const workflowNameSchema = v.pipe(
  v.string(),
  v.check((value) => value.trim().length > 0, "Workflow name cannot be blank"),
  v.description("Workflow name to subscribe to."),
);

export const WorkflowExecutionTriggerSchema = v.strictObject({
  kind: v.pipe(v.literal("workflowExecution"), v.description("Workflow execution event trigger")),
  events: v.pipe(
    v.array(
      v.picklist([
        "workflow.workflow_execution.started",
        "workflow.workflow_execution.completed",
        "workflow.workflow_execution.retried",
        "workflow.workflow_execution.resumed",
        "workflow.workflow_execution.wait_started",
        "workflow.workflow_execution.wait_resolved",
      ]),
    ),
    v.minLength(1),
    v.transform((arr) => [...new Set(arr)]),
    v.description("Workflow execution event types to trigger on"),
  ),
  workflowName: workflowNameSchema,
  condition: v.optional(
    v.pipe(functionSchema, v.description("Condition function to filter events")),
  ),
});

export const WorkflowJobExecutionTriggerSchema = v.strictObject({
  kind: v.pipe(
    v.literal("workflowJobExecution"),
    v.description("Workflow job execution event trigger"),
  ),
  events: v.pipe(
    v.array(
      v.picklist([
        "workflow.workflow_execution.job_execution.started",
        "workflow.workflow_execution.job_execution.completed",
        "workflow.workflow_execution.job_execution.wait_started",
        "workflow.workflow_execution.job_execution.wait_resolved",
      ]),
    ),
    v.minLength(1),
    v.transform((arr) => [...new Set(arr)]),
    v.description("Workflow job execution event types to trigger on"),
  ),
  workflowName: workflowNameSchema,
  condition: v.optional(
    v.pipe(functionSchema, v.description("Condition function to filter events")),
  ),
});

export const TriggerSchema = v.variant("kind", [
  TailorDBTriggerSchema,
  ResolverExecutedTriggerSchema,
  ScheduleTriggerSchema,
  IncomingWebhookTriggerSchema,
  IdpUserTriggerSchema,
  AuthAccessTokenTriggerSchema,
  WorkflowExecutionTriggerSchema,
  WorkflowJobExecutionTriggerSchema,
]);

export const FunctionOperationSchema = v.strictObject({
  kind: v.picklist(["function", "jobFunction"]),
  body: v.pipe(functionSchema, v.description("Function implementation")),
  invoker: v.optional(
    v.pipe(AuthInvokerSchema, v.description("Invoker for the function execution")),
  ),
});

export const GqlOperationSchema = v.strictObject({
  kind: v.literal("graphql"),
  appName: v.optional(
    v.pipe(v.string(), v.description("Target application name for the GraphQL query")),
  ),
  query: v.pipe(
    v.unknown(),
    v.transform((val) => String(val)),
    v.string(),
    v.description("GraphQL query string"),
  ),
  variables: v.optional(
    v.pipe(functionSchema, v.description("Function to compute GraphQL variables")),
  ),
  invoker: v.optional(
    v.pipe(AuthInvokerSchema, v.description("Invoker for the GraphQL execution")),
  ),
});

export const WebhookOperationSchema = v.strictObject({
  kind: v.literal("webhook"),
  url: v.pipe(functionSchema, v.description("Function returning the webhook URL")),
  requestBody: v.optional(
    v.pipe(functionSchema, v.description("Function to compute the request body")),
  ),
  headers: v.optional(
    v.pipe(
      v.record(
        v.string(),
        v.union([v.string(), v.strictObject({ vault: v.string(), key: v.string() })]),
      ),
      v.description("HTTP headers for the webhook request"),
    ),
  ),
});

// v.record() accepts any non-null `typeof value === "object"` input (Date,
// Map, class instances, ...) and simply finds no own enumerable keys to
// validate on them, so a Date or Map would otherwise pass as an empty
// record. Guard with an explicit plain-object check first.
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

function jsonRecordSchema(): v.GenericSchema<Record<string, JsonValue>> {
  return v.pipe(
    v.custom<Record<string, unknown>>(isPlainRecord, "Expected a plain object"),
    v.rawTransform(({ dataset, addIssue, NEVER }) => {
      const result = v.safeParse(v.record(v.string(), JsonValueSchema), dataset.value);
      if (!result.success) {
        for (const issue of result.issues) {
          addIssue({ message: issue.message, path: issue.path });
        }
        return NEVER;
      }
      return result.output;
    }),
  ) as unknown as v.GenericSchema<Record<string, JsonValue>>;
}

export const JsonValueSchema: v.GenericSchema<JsonValue, JsonValue> = v.lazy(() =>
  v.union([
    v.string(),
    v.number(),
    v.boolean(),
    v.null(),
    v.array(JsonValueSchema),
    jsonRecordSchema(),
  ]),
);

export const WorkflowInputSchema: v.GenericSchema<
  Exclude<JsonValue, null>,
  Exclude<JsonValue, null>
> = v.union([v.string(), v.number(), v.boolean(), v.array(JsonValueSchema), jsonRecordSchema()]);

export const WorkflowOperationArgsSchema = v.pipe(
  v.union([WorkflowInputSchema, functionSchema]),
  v.description("Arguments to pass to the workflow"),
);

const workflowOperationShape = {
  kind: v.literal("workflow"),
  args: v.optional(WorkflowOperationArgsSchema),
  invoker: v.optional(
    v.pipe(AuthInvokerSchema, v.description("Invoker for the workflow execution")),
  ),
};

const WorkflowOperationByNameSchema = v.strictObject({
  ...workflowOperationShape,
  workflowName: v.pipe(v.string(), v.description("Name of the workflow to execute")),
  workflow: v.optional(v.never()),
});

const WorkflowOperationByReferenceSchema = v.pipe(
  v.strictObject({
    ...workflowOperationShape,
    workflow: v.looseObject({ name: v.string() }),
    workflowName: v.optional(v.string()),
  }),
  v.transform(({ workflow, ...operation }) => ({
    ...operation,
    workflowName: workflow.name,
  })),
);

export const WorkflowOperationSchema = v.union([
  WorkflowOperationByReferenceSchema,
  WorkflowOperationByNameSchema,
]);

export const OperationSchema = v.union([
  FunctionOperationSchema,
  GqlOperationSchema,
  WebhookOperationSchema,
  WorkflowOperationSchema,
]);

export const ExecutorSchema = v.strictObject({
  name: v.pipe(v.string(), v.description("Executor name")),
  description: v.optional(v.pipe(v.string(), v.description("Executor description"))),
  disabled: v.optional(
    v.pipe(v.boolean(), v.description("Whether the executor is disabled")),
    false,
  ),
  trigger: v.pipe(TriggerSchema, v.description("Event trigger configuration")),
  operation: v.pipe(OperationSchema, v.description("Operation to execute when triggered")),
});
