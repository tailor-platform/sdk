import { PipelineResolverService } from "@/configure/services/pipeline/service";
import { type PipelineResolverServiceInput } from "@/configure/services/pipeline/types";
import { TailorDBService } from "@/configure/services/tailordb/service";
import { type TailorDBServiceInput } from "@/configure/services/tailordb/types";
import { AuthService } from "@/configure/services/auth/service";
import { type AuthConfig } from "@/configure/services/auth";
import { type IdPServiceInput } from "@/configure/services/idp/types";
import { type AppConfig } from "@/configure/config";
import { ExecutorService } from "@/configure/services/executor/service";
import { type ExecutorServiceInput } from "@/configure/services/executor/types";
import { StaticWebsiteService } from "@/configure/services/staticwebsite/service";
import { type StaticWebsiteServiceInput } from "@/configure/services/staticwebsite/types";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _pipelineResolverServices: PipelineResolverService[] = [];
  private _idpService?: IdPServiceInput = {};
  private _authService?: AuthService = undefined;
  private _subgraphs: Array<{ Type: string; Name: string }> = [];
  private _executorService?: ExecutorService = undefined;
  private _staticWebsiteServices: Array<StaticWebsiteService> = [];

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
    return this._idpService as Readonly<IdPServiceInput>;
  }

  get authService() {
    return this._authService as Readonly<AuthService> | undefined;
  }

  get executorService() {
    return this._executorService as Readonly<ExecutorService> | undefined;
  }

  get staticWebsiteServices() {
    return this._staticWebsiteServices as ReadonlyArray<StaticWebsiteService>;
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

  defineIdp(config?: IdPServiceInput) {
    if (!config) {
      return;
    }

    this._idpService = config;
    Object.keys(config).forEach((namespace) =>
      this.addSubgraph("idp", namespace),
    );
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

  defineStaticWebsites(websites?: Record<string, StaticWebsiteServiceInput>) {
    if (!websites) {
      return;
    }
    Object.entries(websites).forEach(([name, config]) => {
      const website = new StaticWebsiteService(name, config);
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
