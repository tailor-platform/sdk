import { PipelineResolverService } from "@/cli/application/pipeline/service";
import { type PipelineResolverServiceInput } from "@/configure/services/pipeline/types";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { type TailorDBServiceInput } from "@/configure/services/tailordb/types";
import { AuthService } from "@/cli/application/auth/service";
import { type AuthConfig } from "@/configure/services/auth";
import { IdPSchema, type IdP, type IdPInput } from "@/parser/service/idp";
import { type AppConfig } from "@/configure/config";
import { ExecutorService } from "@/cli/application/executor/service";
import { type ExecutorServiceInput } from "@/configure/services/executor/types";
import {
  StaticWebsiteSchema,
  type StaticWebsite,
  type StaticWebsiteInput,
} from "@/parser/service/staticwebsite";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _pipelineResolverServices: PipelineResolverService[] = [];
  private _idpServices: IdP[] = [];
  private _authService?: AuthService = undefined;
  private _subgraphs: Array<{ Type: string; Name: string }> = [];
  private _executorService?: ExecutorService = undefined;
  private _staticWebsiteServices: StaticWebsite[] = [];

  constructor(
    public readonly name: string,
    public readonly config: AppConfig,
  ) {}

  private addSubgraph(type: string, name: string) {
    this._subgraphs.push({ Type: type, Name: name });
  }

  get subgraphs() {
    return this._subgraphs as ReadonlyArray<{ Type: string; Name: string }>;
  }

  get tailorDBServices() {
    return this._tailorDBServices as ReadonlyArray<TailorDBService>;
  }

  get pipelineResolverServices() {
    return this
      ._pipelineResolverServices as ReadonlyArray<PipelineResolverService>;
  }

  get idpServices() {
    return this._idpServices as ReadonlyArray<IdP>;
  }

  get authService() {
    return this._authService as Readonly<AuthService> | undefined;
  }

  get executorService() {
    return this._executorService as Readonly<ExecutorService> | undefined;
  }

  get staticWebsiteServices() {
    return this._staticWebsiteServices as ReadonlyArray<StaticWebsite>;
  }

  get applications() {
    return [this] as ReadonlyArray<Application>;
  }

  defineTailorDB(config?: TailorDBServiceInput) {
    if (!config) {
      return;
    }

    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const tailorDB = new TailorDBService(namespace, serviceConfig);
      this._tailorDBServices.push(tailorDB);
      this.addSubgraph("tailordb", tailorDB.namespace);
    }
  }

  definePipeline(config?: PipelineResolverServiceInput) {
    if (!config) {
      return;
    }

    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const pipelineService = new PipelineResolverService(
        namespace,
        serviceConfig,
      );
      this._pipelineResolverServices.push(pipelineService);
      this.addSubgraph("pipeline", pipelineService.namespace);
    }
  }

  defineIdp(config?: readonly IdPInput[]) {
    const idpNames = new Set<string>();
    (config ?? []).forEach((idpConfig) => {
      const idp = IdPSchema.parse(idpConfig);
      if (idpNames.has(idp.name)) {
        throw new Error(`IdP with name "${idp.name}" already defined.`);
      }
      idpNames.add(idp.name);
      this._idpServices.push(idp);
      this.addSubgraph("idp", idp.name);
    });
  }

  defineAuth(config?: AuthConfig) {
    if (!config) {
      return;
    }

    const authService = new AuthService(config, this.tailorDBServices);
    this._authService = authService;
    this.addSubgraph("auth", authService.config.name);
  }

  defineExecutor(config?: ExecutorServiceInput) {
    if (!config) {
      return;
    }
    this._executorService = new ExecutorService(config);
  }

  defineStaticWebsites(websites?: readonly StaticWebsiteInput[]) {
    const websiteNames = new Set<string>();
    (websites ?? []).forEach((config) => {
      const website = StaticWebsiteSchema.parse(config);
      if (websiteNames.has(website.name)) {
        throw new Error(
          `Static website with name "${website.name}" already defined.`,
        );
      }
      websiteNames.add(website.name);
      this._staticWebsiteServices.push(website);
    });
  }
}

export function defineApplication(config: AppConfig) {
  const app = new Application(config.name, config);
  app.defineTailorDB(config.db);
  app.definePipeline(config.pipeline);
  app.defineIdp(config.idp);
  app.defineAuth(config.auth);
  app.defineExecutor(config.executor);
  app.defineStaticWebsites(config.staticWebsites);
  return app;
}
