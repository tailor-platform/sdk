import {
  type GetApplicationSchemaHealthResponse,
  GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus,
} from "@tailor-platform/tailor-proto/application_pb";
import { ApplicationSchemaUpdateAttemptStatus } from "@tailor-platform/tailor-proto/application_resource_pb";
import { formatTimestamp } from "#/cli/shared/format";
import { protoEnumLookup } from "#/cli/shared/proto-enum";
import type { Application } from "@tailor-platform/tailor-proto/application_resource_pb";

export interface AppInfo {
  name: string;
  domain: string;
  authNamespace: string;
  createdAt: Date | null;
  updatedAt: Date | null;
}

export interface AppHealthInfo {
  name: string;
  status: string;
  currentServingSchemaUpdatedAt: Date | null;
  lastAttemptStatus: string;
  lastAttemptAt: Date | null;
  lastAttemptError: string;
}

const HEALTH_STATUS_LABEL = {
  [GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.UNSPECIFIED]: "unknown",
  [GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.OK]: "ok",
  [GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus.COMPOSITION_ERROR]:
    "composition_error",
} satisfies Record<GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus, string>;

const ATTEMPT_STATUS_LABEL = {
  [ApplicationSchemaUpdateAttemptStatus.UNSPECIFIED]: "unknown",
  [ApplicationSchemaUpdateAttemptStatus.SUCCEEDED]: "success",
  [ApplicationSchemaUpdateAttemptStatus.FAILED]: "failure",
} satisfies Record<ApplicationSchemaUpdateAttemptStatus, string>;

const statusToString = (
  status: GetApplicationSchemaHealthResponse_ApplicationSchemaHealthStatus,
): string => protoEnumLookup(HEALTH_STATUS_LABEL, status, "unknown");

const attemptStatusToString = (status: ApplicationSchemaUpdateAttemptStatus): string =>
  protoEnumLookup(ATTEMPT_STATUS_LABEL, status, "unknown");

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
