import { createAuthService, type AuthService } from "@/cli/application/auth/service";
import { createExecutorService, type ExecutorService } from "@/cli/application/executor/service";
import { createResolverService, type ResolverService } from "@/cli/application/resolver/service";
import { createTailorDBService, type TailorDBService } from "@/cli/application/tailordb/service";
import { type AuthConfig } from "@/configure/services/auth";
import { type ExecutorServiceInput } from "@/configure/services/executor/types";
import { type TailorDBServiceInput } from "@/configure/services/tailordb/types";
import { type WorkflowServiceConfig } from "@/configure/services/workflow/types";
import { type AppConfig } from "@/parser/app-config";
import { IdPSchema, type IdP } from "@/parser/service/idp";
import { type ResolverServiceInput } from "@/parser/service/resolver/types";
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

type DefineTailorDBResult = {
  tailorDBServices: TailorDBService[];
  externalTailorDBNamespaces: string[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineTailorDB(config: TailorDBServiceInput | undefined): DefineTailorDBResult {
  const tailorDBServices: TailorDBService[] = [];
  const externalTailorDBNamespaces: string[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { tailorDBServices, externalTailorDBNamespaces, subgraphs };
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

  return { tailorDBServices, externalTailorDBNamespaces, subgraphs };
}

type DefineResolverResult = {
  resolverServices: ResolverService[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineResolver(config: ResolverServiceInput | undefined): DefineResolverResult {
  const resolverServices: ResolverService[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { resolverServices, subgraphs };
  }

  for (const [namespace, serviceConfig] of Object.entries(config)) {
    if (!("external" in serviceConfig)) {
      const resolverService = createResolverService(namespace, serviceConfig);
      resolverServices.push(resolverService);
    }
    subgraphs.push({ Type: "pipeline", Name: namespace });
  }

  return { resolverServices, subgraphs };
}

type DefineIdpResult = {
  idpServices: IdP[];
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineIdp(config: readonly IdPConfig[] | undefined): DefineIdpResult {
  const idpServices: IdP[] = [];
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { idpServices, subgraphs };
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

  return { idpServices, subgraphs };
}

type DefineAuthResult = {
  authService: AuthService | undefined;
  subgraphs: Array<{ Type: string; Name: string }>;
};

function defineAuth(
  config: AuthConfig | undefined,
  tailorDBServices: ReadonlyArray<TailorDBService>,
  externalTailorDBNamespaces: ReadonlyArray<string>,
): DefineAuthResult {
  const subgraphs: Array<{ Type: string; Name: string }> = [];

  if (!config) {
    return { authService: undefined, subgraphs };
  }

  let authService: AuthService | undefined;
  if (!("external" in config)) {
    authService = createAuthService(config, tailorDBServices, externalTailorDBNamespaces);
  }
  subgraphs.push({ Type: "auth", Name: config.name });

  return { authService, subgraphs };
}

type DefineExecutorResult = {
  executorService: ExecutorService | undefined;
};

function defineExecutor(config: ExecutorServiceInput | undefined): DefineExecutorResult {
  if (!config) {
    return { executorService: undefined };
  }
  return { executorService: createExecutorService(config) };
}

type DefineWorkflowResult = {
  workflowConfig: WorkflowServiceConfig | undefined;
};

function defineWorkflow(config: WorkflowServiceConfig | undefined): DefineWorkflowResult {
  return { workflowConfig: config };
}

type DefineStaticWebsitesResult = {
  staticWebsiteServices: StaticWebsite[];
};

function defineStaticWebsites(
  websites: readonly StaticWebsiteInput[] | undefined,
): DefineStaticWebsitesResult {
  const staticWebsiteServices: StaticWebsite[] = [];
  const websiteNames = new Set<string>();

  (websites ?? []).forEach((config) => {
    const website = StaticWebsiteSchema.parse(config);
    if (websiteNames.has(website.name)) {
      throw new Error(`Static website with name "${website.name}" already defined.`);
    }
    websiteNames.add(website.name);
    staticWebsiteServices.push(website);
  });

  return { staticWebsiteServices };
}

/**
 * Define a Tailor application from the given configuration.
 * @param config - Application configuration object
 * @returns Configured application instance
 */
export function defineApplication(config: AppConfig): Application {
  const tailordbResult = defineTailorDB(config.db);
  const resolverResult = defineResolver(config.resolver);
  const idpResult = defineIdp(config.idp);
  const authResult = defineAuth(
    config.auth,
    tailordbResult.tailorDBServices,
    tailordbResult.externalTailorDBNamespaces,
  );
  const executorResult = defineExecutor(config.executor);
  const workflowResult = defineWorkflow(config.workflow);
  const staticWebsiteResult = defineStaticWebsites(config.staticWebsites);

  const subgraphs = [
    ...tailordbResult.subgraphs,
    ...resolverResult.subgraphs,
    ...idpResult.subgraphs,
    ...authResult.subgraphs,
  ];

  const application: Application = {
    name: config.name,
    config,
    subgraphs,
    tailorDBServices: tailordbResult.tailorDBServices,
    externalTailorDBNamespaces: tailordbResult.externalTailorDBNamespaces,
    resolverServices: resolverResult.resolverServices,
    idpServices: idpResult.idpServices,
    authService: authResult.authService,
    executorService: executorResult.executorService,
    workflowConfig: workflowResult.workflowConfig,
    staticWebsiteServices: staticWebsiteResult.staticWebsiteServices,
    env: config.env ?? {},
    get applications() {
      return [application];
    },
  };

  return application;
}
