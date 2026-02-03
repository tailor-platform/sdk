import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import type { FunctionRegistryServiceInput } from "@/configure/services/function-registry/types";
import type { StaticWebsiteConfig } from "@/configure/services/staticwebsite";
import type { WorkflowServiceInput } from "@/configure/services/workflow/types";
import type { AuthConfig } from "@/parser/service/auth/types";
import type { IdPConfig } from "@/parser/service/idp/types";
import type { ResolverServiceInput } from "@/parser/service/resolver/types";
import type { TailorDBServiceInput } from "@/parser/service/tailordb/types";

export interface AppConfig<
  Auth extends AuthConfig = AuthConfig,
  Idp extends IdPConfig[] = IdPConfig[],
  StaticWebsites extends StaticWebsiteConfig[] = StaticWebsiteConfig[],
  Env extends Record<string, string | number | boolean> = Record<string, string | number | boolean>,
> {
  name: string;
  env?: Env;
  cors?: string[];
  allowedIpAddresses?: string[];
  disableIntrospection?: boolean;
  db?: TailorDBServiceInput;
  resolver?: ResolverServiceInput;
  idp?: Idp;
  auth?: Auth;
  executor?: ExecutorServiceInput;
  workflow?: WorkflowServiceInput;
  staticWebsites?: StaticWebsites;
  functionRegistry?: FunctionRegistryServiceInput;
}
