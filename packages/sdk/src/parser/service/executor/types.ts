import type {
  AuthAccessTokenTriggerSchema,
  ExecutorSchema,
  FunctionOperationSchema,
  GqlOperationSchema,
  IdpUserTriggerSchema,
  IncomingWebhookTriggerSchema,
  RecordTriggerSchema,
  ResolverExecutedTriggerSchema,
  ScheduleTriggerSchema,
  TriggerSchema,
  WebhookOperationSchema,
  WorkflowOperationSchema,
} from "./schema";
import type { z } from "zod";

export type RecordTrigger = z.infer<typeof RecordTriggerSchema>;
export type ResolverExecutedTrigger = z.infer<typeof ResolverExecutedTriggerSchema>;
export type ScheduleTriggerInput = z.input<typeof ScheduleTriggerSchema>;
export type IncomingWebhookTrigger = z.infer<typeof IncomingWebhookTriggerSchema>;
export type IdpUserTrigger = z.infer<typeof IdpUserTriggerSchema>;
export type AuthAccessTokenTrigger = z.infer<typeof AuthAccessTokenTriggerSchema>;
export type Trigger = z.infer<typeof TriggerSchema>;

export type FunctionOperation = z.infer<typeof FunctionOperationSchema>;
export type GqlOperation = z.infer<typeof GqlOperationSchema>;
export type WebhookOperation = z.infer<typeof WebhookOperationSchema>;
export type WorkflowOperation = z.infer<typeof WorkflowOperationSchema>;

export type Executor = z.infer<typeof ExecutorSchema>;
export type ExecutorInput = z.input<typeof ExecutorSchema>;
