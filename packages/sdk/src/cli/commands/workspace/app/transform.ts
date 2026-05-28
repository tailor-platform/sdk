import {
  type GetApplicationSchemaHealthResponse,
  GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus,
} from "@tailor-proto/tailor/v1/application_pb";
import { ApplicationSchemaUpdateAttemptStatus } from "@tailor-proto/tailor/v1/application_resource_pb";
import { formatTimestamp } from "@/cli/shared/format";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

export interface AppInfo {
  name: string;
  domain: string;
  authNamespace: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export type SchemaHealthStatus = "ok" | "composition_error" | "unknown";

export type SchemaAttemptStatus = "success" | "failure" | "unknown" | "N/A";

export interface AppHealthInfo {
  name: string;
  status: SchemaHealthStatus;
  currentServingSchemaUpdatedAt: Date | null;
  lastAttemptStatus: SchemaAttemptStatus;
  lastAttemptAt: Date | null;
  lastAttemptError: string;
}

const toSchemaHealthStatus = (
  status: GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus,
): SchemaHealthStatus => {
  switch (status) {
    case GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.OK:
      return "ok";
    case GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.COMPOSITION_ERROR:
      return "composition_error";
    default:
      return "unknown";
  }
};

const toSchemaAttemptStatus = (
  status: ApplicationSchemaUpdateAttemptStatus,
): SchemaAttemptStatus => {
  switch (status) {
    case ApplicationSchemaUpdateAttemptStatus.SUCCEEDED:
      return "success";
    case ApplicationSchemaUpdateAttemptStatus.FAILED:
      return "failure";
    default:
      return "unknown";
  }
};

export const appInfo = (app: Application): AppInfo => {
  return {
    name: app.name,
    domain: app.domain,
    authNamespace: app.authNamespace,
    createdAt: formatTimestamp(app.createTime),
    updatedAt: formatTimestamp(app.updateTime),
  };
};

export const appHealthInfo = (
  name: string,
  health: GetApplicationSchemaHealthResponse,
): AppHealthInfo => {
  const attempt = health.lastSchemaUpdateAttempt;
  return {
    name,
    status: toSchemaHealthStatus(health.status),
    currentServingSchemaUpdatedAt: formatTimestamp(health.currentServingSchemaUpdateTime),
    lastAttemptStatus: attempt ? toSchemaAttemptStatus(attempt.status) : "N/A",
    lastAttemptAt: formatTimestamp(attempt?.attemptTime),
    lastAttemptError: attempt?.error ?? "",
  };
};
