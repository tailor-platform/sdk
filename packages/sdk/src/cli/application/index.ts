import { AuthService } from "@/cli/application/auth/service";
import { ExecutorService } from "@/cli/application/executor/service";
import { ResolverService } from "@/cli/application/resolver/service";
import { TailorDBService } from "@/cli/application/tailordb/service";
import { type AppConfig } from "@/configure/config";
import { type AuthConfig } from "@/configure/services/auth";
import { type ExecutorServiceInput } from "@/configure/services/executor/types";
import { type ResolverServiceInput } from "@/configure/services/resolver/types";
import { type TailorDBServiceInput } from "@/configure/services/tailordb/types";
import { IdPSchema, type IdP } from "@/parser/service/idp";
import {
  StaticWebsiteSchema,
  type StaticWebsite,
  type StaticWebsiteInput,
} from "@/parser/service/staticwebsite";
import type { IdPConfig } from "@/configure/services/idp";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _resolverServices: ResolverService[] = [];
  private _idpServices: IdP[] = [];
  private _authService?: AuthService = undefined;
  private _subgraphs: Array<{ Type: string; Name: string }> = [];
  private _executorService?: ExecutorService = undefined;
  private _staticWebsiteServices: StaticWebsite[] = [];
  private _env: Record<string, string | number | boolean> = {};

  constructor(
    public readonly name: string,
    public readonly config: AppConfig,
  ) {
    this._env = config.env || {};
  }

  private addSubgraph(type: string, name: string) {
    this._subgraphs.push({ Type: type, Name: name });
  }

  get subgraphs() {
    return this._subgraphs as ReadonlyArray<{ Type: string; Name: string }>;
  }

  get tailorDBServices() {
    return this._tailorDBServices as ReadonlyArray<TailorDBService>;
  }

  get resolverServices() {
    return this._resolverServices as ReadonlyArray<ResolverService>;
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

  get env() {
    return this._env as Readonly<Record<string, string | number | boolean>>;
  }

  get applications() {
    return [this] as ReadonlyArray<Application>;
  }

  defineTailorDB(config?: TailorDBServiceInput) {
    if (!config) {
      return;
    }

    for (const [namespace, serviceConfig] of Object.entries(config)) {
      if (!("external" in serviceConfig)) {
        const tailorDB = new TailorDBService(namespace, serviceConfig);
        this._tailorDBServices.push(tailorDB);
      }
      this.addSubgraph("tailordb", namespace);
    }
  }

  defineResolver(config?: ResolverServiceInput) {
    if (!config) {
      return;
    }

    for (const [namespace, serviceConfig] of Object.entries(config)) {
      if (!("external" in serviceConfig)) {
        const resolverService = new ResolverService(namespace, serviceConfig);
        this._resolverServices.push(resolverService);
      }
      this.addSubgraph("pipeline", namespace);
    }
  }

  defineIdp(config?: readonly IdPConfig[]) {
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
        this._idpServices.push(idp);
      }
      this.addSubgraph("idp", name);
    });
  }

  defineAuth(config?: AuthConfig) {
    if (!config) {
      return;
    }

    if (!("external" in config)) {
      const authService = new AuthService(config, this.tailorDBServices);
      this._authService = authService;
    }
    this.addSubgraph("auth", config.name);
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
  app.defineResolver(config.resolver);
  app.defineIdp(config.idp);
  app.defineAuth(config.auth);
  app.defineExecutor(config.executor);
  app.defineStaticWebsites(config.staticWebsites);
  return app;
}
