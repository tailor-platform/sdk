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
  workspaceCreate,
  type WorkspaceCreateOptions,
} from "./workspace/create";
export { workspaceList } from "./workspace/list";
export {
  workspaceDelete,
  type WorkspaceDeleteOptions,
} from "./workspace/delete";
export type { WorkspaceInfo } from "./workspace/transform";
export {
  machineUserList,
  type MachineUserListOptions,
  type MachineUserInfo,
} from "./machineuser/list";
export {
  machineUserToken,
  type MachineUserTokenOptions,
  type MachineUserTokenInfo,
} from "./machineuser/token";
export {
  oauth2ClientGet,
  type OAuth2ClientGetOptions,
} from "./oauth2client/get";
export {
  oauth2ClientList,
  type OAuth2ClientListOptions,
} from "./oauth2client/list";
export type {
  OAuth2ClientInfo,
  OAuth2ClientCredentials,
} from "./oauth2client/transform";
