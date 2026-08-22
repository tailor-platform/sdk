// CLI API exports for programmatic usage
import { registerTsHook } from "./shared/register-ts-hook";

await registerTsHook(new URL("./ts-hook.mjs", import.meta.url));

// CLI foundation shared with plugins. Plugins resolve this package at runtime,
// so logger state (--json / --verbose) set through these args reaches the SDK
// code paths they call into.
export { logger, styles, type LogMode, type LogOptions, type OutOptions } from "./shared/logger";
export { defineAppCommand } from "./shared/command";
export {
  createCommonArgs,
  workspaceArgs,
  configArg,
  deploymentArgs,
  loadEnvFiles,
  type CommonArgsType,
} from "./shared/args";
export { deploy, deploy as apply } from "./commands/deploy/deploy";
export type { DeployOptions, DeployOptions as ApplyOptions } from "./commands/deploy/deploy";
export type { BundledScripts } from "./commands/deploy/function-registry";
export { generate } from "./commands/generate/service";
export type { GenerateOptions } from "./commands/generate/options";
export { loadConfig, type LoadedConfig } from "./shared/config-loader";
export { errorToJson, serializeError, type ErrorToJsonOptions } from "./shared/error-json";
export { generateUserTypes } from "./shared/type-generator";
export {
  loadTailorDBNamespaces,
  type TailorDBNamespaceSelector,
  type LoadTailorDBNamespacesOptions,
  type LoadedTailorDBNamespaces,
} from "./shared/tailordb-namespaces";
export {
  deployStaticWebsite,
  type DeployResult as StaticWebsiteDeployResult,
} from "./commands/staticwebsite/deploy";
export { assertWritable } from "./shared/readonly-guard";
export { isPluginGeneratedTable } from "#/parser/service/tailordb/type-source";
export type {
  GeneratorResult,
  Plugin,
  PluginAttachment,
  TailorDBNamespaceData,
} from "#/plugin/types";
export type {
  TailorDBType,
  TypeSourceInfoEntry,
  ParsedField,
  OperatorFieldConfig,
  PluginGeneratedTableSource,
} from "#/parser/service/tailordb/types";
export type { Resolver } from "#/types/resolver.generated";
export type { Executor } from "#/types/executor.generated";

export {
  show,
  type ShowOptions,
  type ApplicationInfo,
  type ShowInfo,
  type AIGatewayInfo,
} from "./commands/show";
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
export { getFunctionRegistry, type GetFunctionRegistryOptions } from "./commands/function/get";
export {
  listFunctionRegistries,
  type ListFunctionRegistriesOptions,
} from "./commands/function/list";
export type { FunctionRegistryInfo } from "./commands/function/transform";
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
export { getWorkflow, type GetWorkflowTypedOptions } from "./commands/workflow/get";
export type { MachineUserName } from "@tailor-platform/sdk";
export {
  startWorkflow,
  type StartWorkflowTypedOptions,
  type StartWorkflowResultWithWait,
  type WaitOptions,
} from "./commands/workflow/start";
export {
  listWorkflowExecutions,
  getWorkflowExecution,
  type ListWorkflowExecutionsTypedOptions,
  type GetWorkflowExecutionOptions,
  type GetWorkflowExecutionResult,
  type WorkflowExecutionWaitInfo,
} from "./commands/workflow/executions";
export { waitWorkflowExecution, type WorkflowWaitOutput } from "./commands/workflow/wait";
export type { WaitWorkflowExecutionOptions, WorkflowWaitResult } from "./commands/workflow/waiter";
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
  type TriggerExecutorTypedOptions,
  type TriggerExecutorResult,
} from "./commands/executor/trigger";
export {
  listExecutorJobs,
  getExecutorJob,
  getExecutorWaitFailureMessage,
  watchExecutorJob,
  type ListExecutorJobsTypedOptions,
  type GetExecutorJobTypedOptions,
  type WatchExecutorJobTypedOptions,
  type ExecutorJobDetailInfo,
  type WatchExecutorJobResult,
} from "./commands/executor/jobs";
export { listExecutors, type ListExecutorsOptions } from "./commands/executor/list";
export { getExecutor, type GetExecutorTypedOptions } from "./commands/executor/get";
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
export { listOrganizations, type ListOrganizationsOptions } from "./commands/organization/list";
export { getOrganization, type GetOrganizationOptions } from "./commands/organization/get";
export { updateOrganization, type UpdateOrganizationOptions } from "./commands/organization/update";
export { organizationTree, type OrganizationTreeOptions } from "./commands/organization/tree";
export type {
  UserOrganizationInfo,
  OrganizationInfo,
  FolderListInfo,
  FolderInfo,
} from "./commands/organization/transform";
export { listFolders, type ListFoldersOptions } from "./commands/organization/folder/list";
export { getFolder, type GetFolderOptions } from "./commands/organization/folder/get";
export { createFolder, type CreateFolderOptions } from "./commands/organization/folder/create";
export { updateFolder, type UpdateFolderOptions } from "./commands/organization/folder/update";
export { deleteFolder, type DeleteFolderOptions } from "./commands/organization/folder/delete";
export { loadAccessToken, loadWorkspaceId } from "./shared/context";
export { apiCall, type ApiCallOptions, type ApiCallResult } from "./commands/api";
export { query } from "./query";
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
  MIGRATE_TEST_FILE_NAME,
  DB_TYPES_FILE_NAME,
  INITIAL_SCHEMA_NUMBER,
  getMigrationDirPath,
  getMigrationFilePath,
  type SchemaSnapshot,
  type NormalizedSchemaSnapshot,
  type TailorDBSnapshotType,
  type SnapshotFieldConfig,
} from "./commands/tailordb/migrate/snapshot";
export { MIGRATION_LABEL_KEY } from "./commands/tailordb/migrate/types";

// Seed exports
export {
  loadSeedContext,
  type LoadSeedContextOptions,
  type SeedContext,
  type SeedIdpUserContext,
  type SeedNamespaceConfig,
} from "./shared/seed-context";
export {
  chunkSeedData,
  type SeedChunk,
  type ChunkSeedDataOptions,
  type SeedData,
} from "./shared/seed-chunker";
export { bundleSeedScript, type SeedBundleResult } from "./commands/generate/seed/bundler";
export {
  bundleMigrationScript,
  type MigrationBundleResult,
} from "./commands/tailordb/migrate/bundler";
export {
  executeScript,
  waitForExecution,
  type ScriptExecutionOptions,
  type ScriptExecutionResult,
  type ScriptInvoker,
  type ExecutionWaitResult,
} from "./shared/script-executor";
export { initOperatorClient, type OperatorClient } from "./shared/client";
export type { AuthInvoker } from "@tailor-platform/tailor-proto/auth_resource_pb";
