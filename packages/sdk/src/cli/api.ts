// CLI API exports for programmatic usage
import { register } from "node:module";

// Register tsx to handle TypeScript files when using CLI API programmatically
register("tsx", import.meta.url, { data: {} });

export { apply } from "./apply/index";
export type { ApplyOptions } from "./apply/index";
export { generate } from "./generator/index";
export type { GenerateOptions } from "./generator/options";
export { loadConfig } from "./config-loader";
export { generateUserTypes } from "./type-generator";
export type {
  CodeGenerator,
  GeneratorInput,
  GeneratorResult,
} from "./generator/types";
export type { ParsedTailorDBType as TailorDBType } from "@/parser/service/tailordb/types";
export type { Resolver } from "@/parser/service/resolver";
export type { Executor } from "@/parser/service/executor";

export { show, type ShowOptions, type ApplicationInfo } from "./show";
export { remove, type RemoveOptions } from "./remove";
export {
  createWorkspace,
  type CreateWorkspaceOptions,
} from "./workspace/create";
export { listWorkspaces, type ListWorkspacesOptions } from "./workspace/list";
export {
  deleteWorkspace,
  type DeleteWorkspaceOptions,
} from "./workspace/delete";
export type { WorkspaceInfo } from "./workspace/transform";
export {
  listMachineUsers,
  type ListMachineUsersOptions,
  type MachineUserInfo,
} from "./machineuser/list";
export {
  getMachineUserToken,
  type GetMachineUserTokenOptions,
  type MachineUserTokenInfo,
} from "./machineuser/token";
export {
  getOAuth2Client,
  type GetOAuth2ClientOptions,
} from "./oauth2client/get";
export {
  listOAuth2Clients,
  type ListOAuth2ClientsOptions,
} from "./oauth2client/list";
export type {
  OAuth2ClientInfo,
  OAuth2ClientCredentials,
} from "./oauth2client/transform";
export { listWorkflows, type ListWorkflowsOptions } from "./workflow/list";
export { getWorkflow, type GetWorkflowOptions } from "./workflow/get";
export {
  startWorkflow,
  type StartWorkflowOptions,
  type StartWorkflowResultWithWait,
  type WaitOptions,
} from "./workflow/start";
export {
  listWorkflowExecutions,
  getWorkflowExecution,
  type ListWorkflowExecutionsOptions,
  type GetWorkflowExecutionOptions,
  type GetWorkflowExecutionResult,
} from "./workflow/executions";
export {
  resumeWorkflow,
  type ResumeWorkflowOptions,
  type ResumeWorkflowResultWithWait,
} from "./workflow/resume";
export type {
  WorkflowListInfo,
  WorkflowInfo,
  WorkflowExecutionInfo,
  WorkflowJobExecutionInfo,
} from "./workflow/transform";
export { loadAccessToken, loadWorkspaceId } from "./context";
