import { measure } from "@/performance";
import { Application } from "@/application";
import { AppConfig, type WorkspaceConfig } from "@/config";

export class Workspace {
  constructor(public readonly config: WorkspaceConfig) {}

  private readonly _applications: Array<Application> = [];
  get applications() {
    return this._applications as ReadonlyArray<Application>;
  }

  @measure
  newApplication(name: string, appConfig: AppConfig) {
    const app = new Application(name);
    app.defineAuth(appConfig.auth);
    app.defineTailorDB(appConfig.db);
    app.definePipeline(appConfig.pipeline);

    this._applications.push(app);
    return app;
  }
}

export function defineWorkspace(config: WorkspaceConfig) {
  const workspace = new Workspace(config);
  Object.entries(config.app).forEach(([name, appConfig]) =>
    workspace.newApplication(name, appConfig),
  );
  return workspace;
}
