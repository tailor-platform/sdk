import {
  type GetApplicationSchemaHealthResponse,
  GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus,
} from "@tailor-proto/tailor/v1/application_pb";
import { ApplicationSchemaUpdateAttemptStatus } from "@tailor-proto/tailor/v1/application_resource_pb";
import { formatTimestamp } from "../../utils/format";
import type { Application } from "@tailor-proto/tailor/v1/application_resource_pb";

export interface AppInfo {
  name: string;
  domain: string;
  authNamespace: string;
  createdAt: string;
  updatedAt: string;
}

export interface AppHealthInfo {
  name: string;
  status: string;
  currentServingSchemaUpdatedAt: string;
  lastAttemptStatus: string;
  lastAttemptAt: string;
  lastAttemptError: string;
}

const statusToString = (
  status: GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus,
): string => {
  switch (status) {
    case GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.OK:
      return "ok";
    case GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.COMPOSITION_ERROR:
      return "composition_error";
    default:
      return "unknown";
  }
};

const attemptStatusToString = (status: ApplicationSchemaUpdateAttemptStatus): string => {
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
    status: statusToString(health.status),
    currentServingSchemaUpdatedAt: formatTimestamp(health.currentServingSchemaUpdateTime),
    lastAttemptStatus: attempt ? attemptStatusToString(attempt.status) : "N/A",
    lastAttemptAt: formatTimestamp(attempt?.attemptTime),
    lastAttemptError: attempt?.error ?? "",
  };
};
