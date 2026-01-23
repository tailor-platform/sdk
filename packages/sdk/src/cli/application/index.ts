import { createAuthService, type AuthService } from "@/cli/application/auth/service";
import { createExecutorService, type ExecutorService } from "@/cli/application/executor/service";
import { createResolverService, type ResolverService } from "@/cli/application/resolver/service";
import { createTailorDBService, type TailorDBService } from "@/cli/application/tailordb/service";
import { type AppConfig } from "@/configure/config";
import { type AuthConfig } from "@/configure/services/auth";
import { type ExecutorServiceInput } from "@/configure/services/executor/types";
import { type ResolverServiceInput } from "@/configure/services/resolver/types";
import { type TailorDBServiceInput } from "@/configure/services/tailordb/types";
import { type WorkflowServiceConfig } from "@/configure/services/workflow/types";
import { IdPSchema, type IdP } from "@/parser/service/idp";
import {
  StaticWebsiteSchema,
  type StaticWebsite,
  type StaticWebsiteInput,
} from "@/parser/service/staticwebsite";
import type { IdPConfig } from "@/configure/services/idp";

export type Application = {
  readonly name: string;
  readonly config: AppConfig;
  readonly subgraphs: ReadonlyArray<{ Type: string; Name: string }>;
  readonly tailorDBServices: ReadonlyArray<TailorDBService>;
  readonly externalTailorDBNamespaces: ReadonlyArray<string>;
  readonly resolverServices: ReadonlyArray<ResolverService>;
  readonly idpServices: ReadonlyArray<IdP>;
  readonly authService: Readonly<AuthService> | undefined;
  readonly executorService: Readonly<ExecutorService> | undefined;
  readonly workflowConfig: WorkflowServiceConfig | undefined;
  readonly staticWebsiteServices: ReadonlyArray<StaticWebsite>;
  readonly env: Readonly<Record<string, string | number | boolean>>;
  readonly applications: ReadonlyArray<Application>;
};

function defineTailorDB(
  config: TailorDBServiceInput | undefined,
  tailorDBServices: TailorDBService[],
  externalTailorDBNamespaces: string[],
  subgraphs: Array<{ Type: string; Name: string }>,
): void {
  if (!config) {
    return;
  }

  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if ("external" in serviceConfig) {
      externalTailorDBNamespaces.push(namespace);
    } else {
      const tailorDB = createTailorDBService(namespace, serviceConfig);
      tailorDBServices.push(tailorDB);
    }
    subgraphs.push({ Type: "tailordb", Name: namespace });
  }
}

function defineResolver(
  config: ResolverServiceInput | undefined,
  resolverServices: ResolverService[],
  subgraphs: Array<{ Type: string; Name: string }>,
): void {
  if (!config) {
    return;
  }

  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if (!("external" in serviceConfig)) {
      const resolverService = createResolverService(namespace, serviceConfig);
      resolverServices.push(resolverService);
    }
    subgraphs.push({ Type: "pipeline", Name: namespace });
  }
}

function defineIdp(
  config: readonly IdPConfig[] | undefined,
  idpServices: IdP[],
  subgraphs: Array<{ Type: string; Name: string }>,
): void {
  if (!config) {
    return;
  }

  const idpNames = new Set<string>();
  config.forEach((idpConfig) => {
    const name = idpConfig.name;
    if (idpNames.has(name)) {
      throw new Error(`IdP with name "${name}" already defined.`);
    }
    idpNames.add(name);
    if (!("external" in idpConfig)) {
      const idp = IdPSchema.parse(idpConfig);
      idpServices.push(idp);
    }
    subgraphs.push({ Type: "idp", Name: name });
  });
}

function defineAuth(
  config: AuthConfig | undefined,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  externalTailorDBNamespaces: ReadonlyArray<string>,
  subgraphs: Array<{ Type: string; Name: string }>,
): AuthService | undefined {
  if (!config) {
    return undefined;
  }

  let authService: AuthService | undefined;
  if (!("external" in config)) {
    authService = createAuthService(config, tailorDBServices, externalTailorDBNamespaces);
  }
  subgraphs.push({ Type: "auth", Name: config.name });
  return authService;
}

function defineExecutor(config: ExecutorServiceInput | undefined): ExecutorService | undefined {
  if (!config) {
    return undefined;
  }
  return createExecutorService(config);
}

function defineWorkflow(
  config: WorkflowServiceConfig | undefined,
): WorkflowServiceConfig | undefined {
  return config;
}

function defineStaticWebsites(
  websites: readonly StaticWebsiteInput[] | undefined,
  staticWebsiteServices: StaticWebsite[],
): void {
  const websiteNames = new Set<string>();
  (websites ?? []).forEach((config) => {
    const website = StaticWebsiteSchema.parse(config);
    if (websiteNames.has(website.name)) {
      throw new Error(`Static website with name "${website.name}" already defined.`);
    }
    websiteNames.add(website.name);
    staticWebsiteServices.push(website);
  });
}

/**
 * Define a Tailor application from the given configuration.
 * @param config - Application configuration object
 * @returns Configured application instance
 */
export function defineApplication(config: AppConfig): Application {
  const tailorDBServices: TailorDBService[] = [];
  const externalTailorDBNamespaces: string[] = [];
  const resolverServices: ResolverService[] = [];
  const idpServices: IdP[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];
  const staticWebsiteServices: StaticWebsite[] = [];

  defineTailorDB(config.db, tailorDBServices, externalTailorDBNamespaces, subgraphs);
  defineResolver(config.resolver, resolverServices, subgraphs);
  defineIdp(config.idp, idpServices, subgraphs);
  const authService = defineAuth(
    config.auth,
    tailorDBServices,
    externalTailorDBNamespaces,
    subgraphs,
  );
  const executorService = defineExecutor(config.executor);
  const workflowConfig = defineWorkflow(config.workflow);
  defineStaticWebsites(config.staticWebsites, staticWebsiteServices);

  const application: Application = {
    name: config.name,
    config,
    subgraphs,
    tailorDBServices,
    externalTailorDBNamespaces,
    resolverServices,
    idpServices,
    authService,
    executorService,
    workflowConfig,
    staticWebsiteServices,
    env: config.env ?? {},
    get applications() {
      return [application];
    },
  };

  return application;
}
