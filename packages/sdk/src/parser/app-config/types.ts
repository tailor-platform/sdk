import type { AuthConfig } from "@/configure/services/auth";
import type { ExecutorServiceInput } from "@/configure/services/executor/types";
import type { IdPConfig } from "@/configure/services/idp";
import type { StaticWebsiteConfig } from "@/configure/services/staticwebsite";
import type { TailorDBServiceInput } from "@/configure/services/tailordb/types";
import type { WorkflowServiceInput } from "@/configure/services/workflow/types";
import type { ResolverServiceInput } from "@/parser/service/resolver/types";

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
}
