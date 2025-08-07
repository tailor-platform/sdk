import { Application } from "@/application";
import type { AppConfig, WorkspaceConfig } from "@/config";
import { ExecutorService } from "./services/executor/service";
import { ExecutorServiceInput } from "./services/executor/types";

export class Workspace {
  private _executorService?: ExecutorService = undefined;

  constructor(public readonly config: WorkspaceConfig) {
    this.defineExecutor(config.executor);
  }

  get executorService() {
    return this._executorService as Readonly<ExecutorService> | undefined;
  }

  private readonly _applications: Array<Application> = [];
  get applications() {
    return this._applications as ReadonlyArray<Application>;
  }

  newApplication(name: string, appConfig: AppConfig) {
    const app = new Application(name);
    app.defineTailorDB(appConfig.db);
    app.definePipeline(appConfig.pipeline);
    app.defineIdp(appConfig.idp);
    app.defineAuth(appConfig.auth);

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
}

export function defineWorkspace(config: WorkspaceConfig) {
  const workspace = new Workspace(config);
  Object.entries(config.app).forEach(([name, appConfig]) =>
    workspace.newApplication(name, appConfig),
  );
  return workspace;
}
