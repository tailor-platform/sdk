// CLI API exports for programmatic usage
import { register } from "node:module";

// Register tsx to handle TypeScript files when using CLI API programmatically
register("tsx", import.meta.url, { data: {} });

export { apply } from "./commands/apply/apply";
export type { ApplyOptions } from "./commands/apply/apply";
export { generate } from "./commands/generate/service";
export type { GenerateOptions } from "./commands/generate/options";
export { loadConfig, type LoadedConfig } from "./shared/config-loader";
export { generateUserTypes } from "./shared/type-generator";
export type {
  CodeGenerator,
  TailorDBGenerator,
  ResolverGenerator,
  ExecutorGenerator,
  TailorDBResolverGenerator,
  FullCodeGenerator,
  TailorDBInput,
  ResolverInput,
  ExecutorInput,
  FullInput,
  AggregateArgs,
  GeneratorResult,
  DependencyKind,
  PluginAttachment,
  TypeSourceInfoEntry,
} from "./commands/generate/types";
export type { TailorDBType } from "@/parser/service/tailordb/types";
export type { Resolver } from "@/parser/service/resolver";
export type { Executor } from "@/parser/service/executor";

/** @deprecated Import from '@tailor-platform/sdk/plugin/kysely-type' instead */
export { kyselyTypePlugin } from "@/plugin/builtin/kysely-type";
/** @deprecated Import from '@tailor-platform/sdk/plugin/enum-constants' instead */
export { enumConstantsPlugin } from "@/plugin/builtin/enum-constants";
/** @deprecated Import from '@tailor-platform/sdk/plugin/file-utils' instead */
export { fileUtilsPlugin } from "@/plugin/builtin/file-utils";
/** @deprecated Import from '@tailor-platform/sdk/plugin/seed' instead */
export { seedPlugin } from "@/plugin/builtin/seed";

export { show, type ShowOptions, type ApplicationInfo } from "./commands/show";
export { remove, type RemoveOptions } from "./commands/remove";
export { createWorkspace, type CreateWorkspaceOptions } from "./commands/workspace/create";
export { listWorkspaces, type ListWorkspacesOptions } from "./commands/workspace/list";
export { deleteWorkspace, type DeleteWorkspaceOptions } from "./commands/workspace/delete";
export { getWorkspace, type GetWorkspaceOptions } from "./commands/workspace/get";
export { restoreWorkspace, type RestoreWorkspaceOptions } from "./commands/workspace/restore";
export type { WorkspaceInfo, WorkspaceDetails } from "./commands/workspace/transform";
export { listUsers, type ListUsersOptions } from "./commands/workspace/user/list";
export { inviteUser, type InviteUserOptions } from "./commands/workspace/user/invite";
export { updateUser, type UpdateUserOptions } from "./commands/workspace/user/update";
export { removeUser, type RemoveUserOptions } from "./commands/workspace/user/remove";
export type { UserInfo } from "./commands/workspace/user/transform";
export { listApps, type ListAppsOptions } from "./commands/workspace/app/list";
export {
  getAppHealth,
  type HealthOptions as GetAppHealthOptions,
} from "./commands/workspace/app/health";
export type { AppInfo, AppHealthInfo } from "./commands/workspace/app/transform";
export {
  listMachineUsers,
  type ListMachineUsersOptions,
  type MachineUserInfo,
} from "./commands/machineuser/list";
export {
  getMachineUserToken,
  type GetMachineUserTokenOptions,
  type MachineUserTokenInfo,
} from "./commands/machineuser/token";
export { getOAuth2Client, type GetOAuth2ClientOptions } from "./commands/oauth2client/get";
export { listOAuth2Clients, type ListOAuth2ClientsOptions } from "./commands/oauth2client/list";
export type { OAuth2ClientInfo, OAuth2ClientCredentials } from "./commands/oauth2client/transform";
export { listWorkflows, type ListWorkflowsOptions } from "./commands/workflow/list";
export {
  getWorkflow,
  type GetWorkflowOptions,
  type GetWorkflowTypedOptions,
} from "./commands/workflow/get";
export {
  startWorkflow,
  type StartWorkflowOptions,
  type StartWorkflowTypedOptions,
  type StartWorkflowResultWithWait,
  type WaitOptions,
} from "./commands/workflow/start";
export {
  listWorkflowExecutions,
  getWorkflowExecution,
  type ListWorkflowExecutionsOptions,
  type ListWorkflowExecutionsTypedOptions,
  type GetWorkflowExecutionOptions,
  type GetWorkflowExecutionResult,
} from "./commands/workflow/executions";
export {
  resumeWorkflow,
  type ResumeWorkflowOptions,
  type ResumeWorkflowResultWithWait,
} from "./commands/workflow/resume";
export type {
  WorkflowListInfo,
  WorkflowInfo,
  WorkflowExecutionInfo,
  WorkflowJobExecutionInfo,
} from "./commands/workflow/transform";
export {
  triggerExecutor,
  type TriggerExecutorOptions,
  type TriggerExecutorTypedOptions,
  type TriggerExecutorResult,
} from "./commands/executor/trigger";
export {
  listExecutorJobs,
  getExecutorJob,
  watchExecutorJob,
  type ListExecutorJobsOptions,
  type ListExecutorJobsTypedOptions,
  type GetExecutorJobOptions,
  type GetExecutorJobTypedOptions,
  type WatchExecutorJobOptions,
  type WatchExecutorJobTypedOptions,
  type ExecutorJobDetailInfo,
  type WatchExecutorJobResult,
} from "./commands/executor/jobs";
export { listExecutors, type ListExecutorsOptions } from "./commands/executor/list";
export {
  getExecutor,
  type GetExecutorOptions,
  type GetExecutorTypedOptions,
} from "./commands/executor/get";
export {
  listWebhookExecutors,
  type ListWebhookExecutorsOptions,
  type WebhookExecutorInfo,
} from "./commands/executor/webhook";
export type {
  ExecutorJobListInfo,
  ExecutorJobInfo,
  ExecutorJobAttemptInfo,
  ExecutorListInfo,
  ExecutorInfo,
} from "./commands/executor/transform";
export { loadAccessToken, loadWorkspaceId } from "./shared/context";
export { apiCall, type ApiCallOptions, type ApiCallResult } from "./commands/api";
export { truncate, type TruncateOptions } from "./commands/tailordb/truncate";

// Migration exports
export {
  generate as migrateGenerate,
  type GenerateOptions as MigrateGenerateOptions,
} from "./commands/tailordb/migrate/generate";
export {
  createSnapshotFromLocalTypes,
  reconstructSnapshotFromMigrations,
  compareSnapshots,
  getNextMigrationNumber,
  getLatestMigrationNumber,
  getMigrationFiles,
  compareLocalTypesWithSnapshot,
} from "./commands/tailordb/migrate/snapshot";
export {
  getNamespacesWithMigrations,
  type NamespaceWithMigrations,
} from "./commands/tailordb/migrate/config";
export {
  hasChanges,
  formatMigrationDiff,
  formatDiffSummary,
  type MigrationDiff,
  type BreakingChangeInfo,
} from "./commands/tailordb/migrate/diff-calculator";
export {
  SCHEMA_FILE_NAME,
  DIFF_FILE_NAME,
  MIGRATE_FILE_NAME,
  DB_TYPES_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  getMigrationDirPath,
  getMigrationFilePath,
  type SchemaSnapshot,
  type SnapshotType,
  type SnapshotFieldConfig,
  type MigrationInfo,
} from "./commands/tailordb/migrate/snapshot";
export { MIGRATION_LABEL_KEY } from "./commands/tailordb/migrate/types";

// Seed exports
export { chunkSeedData, type SeedChunk, type ChunkSeedDataOptions } from "./shared/seed-chunker";
export { bundleSeedScript, type SeedBundleResult } from "./services/bundler/seed/seed-bundler";
export {
  bundleMigrationScript,
  type MigrationBundleResult,
} from "./services/bundler/migration/migration-bundler";
export {
  executeScript,
  waitForExecution,
  type ScriptExecutionOptions,
  type ScriptExecutionResult,
  type ExecutionWaitResult,
} from "./shared/script-executor";
export { initOperatorClient, type OperatorClient } from "./shared/client";
export type { AuthInvoker } from "@tailor-proto/tailor/v1/auth_resource_pb";
