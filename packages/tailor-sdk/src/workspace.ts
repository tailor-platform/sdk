import { Application } from "@/application";
import type { AppConfig, WorkspaceConfig } from "@/config";
import { ExecutorService } from "./services/executor/service";
import { type ExecutorServiceInput } from "./services/executor/types";
import { StaticWebsiteService } from "./services/staticwebsite/service";
import { type StaticWebsiteServiceInput } from "./services/staticwebsite/types";

export class Workspace {
  private _executorService?: ExecutorService = undefined;
  private _staticWebsiteServices: Array<StaticWebsiteService> = [];

  constructor(public readonly config: WorkspaceConfig) {
    this.defineExecutor(config.executor);
    this.defineStaticWebsites(config.staticWebsites);
  }

  get executorService() {
    return this._executorService as Readonly<ExecutorService> | undefined;
  }

  get staticWebsiteServices() {
    return this._staticWebsiteServices as ReadonlyArray<StaticWebsiteService>;
  }

  private readonly _applications: Array<Application> = [];
  get applications() {
    return this._applications as ReadonlyArray<Application>;
  }

  newApplication(name: string, appConfig: AppConfig) {
    const app = new Application(name, appConfig);
    app.defineTailorDB(appConfig.db);
    app.definePipeline(appConfig.pipeline);
    app.defineIdp(appConfig.idp);
    app.defineAuth(appConfig.auth); // Define auth after idp/tailordb

    this._applications.push(app);
    return app;
  }

  private defineExecutor(config?: ExecutorServiceInput) {
    if (!config) {
      return;
    }
    // Use workspace name as namespace for executor service
    this._executorService = new ExecutorService(config);
  }

  private defineStaticWebsites(
    websites?: Record<string, StaticWebsiteServiceInput>,
  ) {
    if (!websites) {
      return;
    }
    Object.entries(websites).forEach(([name, config]) => {
      const website = new StaticWebsiteService(name, config);
      this._staticWebsiteServices.push(website);
    });
  }
}

export function defineWorkspace(config: WorkspaceConfig) {
  const workspace = new Workspace(config);
  Object.entries(config.app).forEach(([name, appConfig]) =>
    workspace.newApplication(name, appConfig),
  );
  return workspace;
}
