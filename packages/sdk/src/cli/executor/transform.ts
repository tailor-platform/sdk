import { timestampDate } from "@bufbuild/protobuf/wkt";
import { ExecutorJobStatus } from "@tailor-proto/tailor/v1/executor_resource_pb";
import { executorTargetTypeToString, executorTriggerTypeToString } from "./status";
import type {
  ExecutorExecutor,
  ExecutorJob,
  ExecutorJobAttempt,
} from "@tailor-proto/tailor/v1/executor_resource_pb";

export interface ExecutorJobListInfo {
  id: string;
  executorName: string;
  status: string;
  createdAt: string;
}

export interface ExecutorJobInfo {
  id: string;
  executorName: string;
  status: string;
  scheduledAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExecutorJobAttemptInfo {
  id: string;
  jobId: string;
  status: string;
  error: string;
  startedAt: string;
  finishedAt: string;
  operationReference: string;
}

function executorJobStatusToString(status: ExecutorJobStatus): string {
  switch (status) {
    case ExecutorJobStatus.PENDING:
      return "PENDING";
    case ExecutorJobStatus.RUNNING:
      return "RUNNING";
    case ExecutorJobStatus.SUCCESS:
      return "SUCCESS";
    case ExecutorJobStatus.FAILED:
      return "FAILED";
    case ExecutorJobStatus.CANCELED:
      return "CANCELED";
    default:
      return "UNSPECIFIED";
  }
}

/**
 * Transform ExecutorJob to ExecutorJobListInfo for list display.
 * @param job - ExecutorJob from proto
 * @returns Executor job list info
 */
export function toExecutorJobListInfo(job: ExecutorJob): ExecutorJobListInfo {
  return {
    id: job.id,
    executorName: job.executorName,
    status: executorJobStatusToString(job.status),
    createdAt: job.createdAt ? timestampDate(job.createdAt).toISOString() : "N/A",
  };
}

/**
 * Transform ExecutorJob to ExecutorJobInfo for detail display.
 * @param job - ExecutorJob from proto
 * @returns Executor job info
 */
export function toExecutorJobInfo(job: ExecutorJob): ExecutorJobInfo {
  return {
    id: job.id,
    executorName: job.executorName,
    status: executorJobStatusToString(job.status),
    scheduledAt: job.scheduledAt ? timestampDate(job.scheduledAt).toISOString() : "N/A",
    createdAt: job.createdAt ? timestampDate(job.createdAt).toISOString() : "N/A",
    updatedAt: job.updatedAt ? timestampDate(job.updatedAt).toISOString() : "N/A",
  };
}

/**
 * Transform ExecutorJobAttempt to ExecutorJobAttemptInfo.
 * @param attempt - ExecutorJobAttempt from proto
 * @returns Executor job attempt info
 */
export function toExecutorJobAttemptInfo(attempt: ExecutorJobAttempt): ExecutorJobAttemptInfo {
  return {
    id: attempt.id,
    jobId: attempt.jobId,
    status: executorJobStatusToString(attempt.status),
    error: attempt.error || "",
    startedAt: attempt.startedAt ? timestampDate(attempt.startedAt).toISOString() : "N/A",
    finishedAt: attempt.finishedAt ? timestampDate(attempt.finishedAt).toISOString() : "N/A",
    operationReference: attempt.operationReference || "",
  };
}

// ============================================================================
// Executor (ExecutorExecutor) Transform Functions
// ============================================================================

export interface ExecutorListInfo {
  name: string;
  triggerType: string;
  targetType: string;
  disabled: boolean;
}

export interface ExecutorInfo {
  name: string;
  description: string;
  triggerType: string;
  targetType: string;
  disabled: boolean;
  triggerConfig: string;
  targetConfig: string;
}

/**
 * Format trigger type for human-readable display.
 * Examples:
 *   - event with typeName "User" and action "created" → "event: User created"
 *   - event with resolverName "myResolver" → "event: myResolver executed"
 *   - schedule with frequency "0 12 * * *" and timezone "UTC" → "schedule: 0 12 * * * (UTC)"
 *   - incomingWebhook → "webhook"
 * @param executor - Executor from proto
 * @returns Formatted trigger type string
 */
function formatTriggerType(executor: ExecutorExecutor): string {
  const config = executor.triggerConfig?.config;
  if (!config || config.case === undefined) {
    return executorTriggerTypeToString(executor.triggerType);
  }

  switch (config.case) {
    case "schedule":
      return `schedule: ${config.value.frequency} (${config.value.timezone})`;
    case "event":
      return formatEventTrigger(config.value.eventType, config.value.condition?.expr);
    case "incomingWebhook":
      return "webhook";
    default:
      return executorTriggerTypeToString(executor.triggerType);
  }
}

/**
 * Format event trigger for display by parsing condition to extract type/resolver name.
 * @param eventType - Event type string (e.g., "tailordb.type_record.created")
 * @param condition - Condition expression that may contain args.typeName or args.resolverName
 * @returns Formatted string (e.g., "event: User created")
 */
function formatEventTrigger(eventType: string, condition?: string): string {
  const parts = eventType.split(".");
  if (parts.length < 3) {
    return `event: ${eventType}`;
  }

  const [service, resource, action] = parts;

  // Try to extract name from condition
  if (condition) {
    // Match args.typeName === "User" or args.typeName === 'User'
    const typeNameMatch = condition.match(/args\.typeName\s*===?\s*["']([^"']+)["']/);
    if (typeNameMatch) {
      return `event: ${typeNameMatch[1]} ${action}`;
    }

    // Match args.resolverName === "myResolver" or args.resolverName === 'myResolver'
    const resolverNameMatch = condition.match(/args\.resolverName\s*===?\s*["']([^"']+)["']/);
    if (resolverNameMatch) {
      return `event: ${resolverNameMatch[1]} ${action}`;
    }
  }

  // Fallback: use service, resource and action
  return `event: ${service} ${resource} ${action}`;
}

/**
 * Format trigger config for display.
 * @param executor - Executor from proto
 * @returns Formatted trigger config
 */
function formatTriggerConfig(executor: ExecutorExecutor): Record<string, unknown> {
  const config = executor.triggerConfig?.config;
  if (!config || config.case === undefined) {
    return {};
  }

  switch (config.case) {
    case "schedule":
      return {
        timezone: config.value.timezone,
        frequency: config.value.frequency,
      };
    case "event":
      return {
        eventType: config.value.eventType,
        condition: config.value.condition?.expr || "",
      };
    case "incomingWebhook":
      return {
        secret: config.value.secret ? "***" : "",
      };
    default:
      return {};
  }
}

/**
 * Format target config for display.
 * @param executor - Executor from proto
 * @returns Formatted target config
 */
function formatTargetConfig(executor: ExecutorExecutor): Record<string, unknown> {
  const config = executor.targetConfig?.config;
  if (!config || config.case === undefined) {
    return {};
  }

  switch (config.case) {
    case "webhook":
      return {
        url: config.value.url?.expr || "",
        headers: config.value.headers.length,
      };
    case "tailorGraphql":
      return {
        appName: config.value.appName,
        query: config.value.query,
      };
    case "function":
      return {
        name: config.value.name,
      };
    case "workflow":
      return {
        workflowName: config.value.workflowName,
      };
    default:
      return {};
  }
}

/**
 * Transform ExecutorExecutor to ExecutorListInfo for list display.
 * @param executor - Executor from proto
 * @returns Executor list info
 */
export function toExecutorListInfo(executor: ExecutorExecutor): ExecutorListInfo {
  return {
    name: executor.name,
    triggerType: formatTriggerType(executor),
    targetType: executorTargetTypeToString(executor.targetType),
    disabled: executor.disabled,
  };
}

/**
 * Transform ExecutorExecutor to ExecutorInfo for detail display.
 * @param executor - Executor from proto
 * @returns Executor info
 */
export function toExecutorInfo(executor: ExecutorExecutor): ExecutorInfo {
  return {
    name: executor.name,
    description: executor.description,
    triggerType: formatTriggerType(executor),
    targetType: executorTargetTypeToString(executor.targetType),
    disabled: executor.disabled,
    triggerConfig: JSON.stringify(formatTriggerConfig(executor), null, 2),
    targetConfig: JSON.stringify(formatTargetConfig(executor), null, 2),
  };
}
