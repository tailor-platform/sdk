/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import fs from "node:fs";
import { measure } from "@/performance";
import { TailorCtl } from "@/ctl";
import { Application } from "@/application";
import { AppConfig, getDistDir, type WorkspaceConfig } from "@/config";
import { ApplyOptions } from "@/cli/args";

class Workspace {
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
    app.defineResolver(appConfig.resolver);

    this._applications.push(app);
    return app;
  }

  @measure
  async apply(options: ApplyOptions) {
    const client = new TailorCtl(options);
    const workspace = await client.upsertWorkspace({
      name: this.config.name,
      region: this.config.region,
    });
    console.log(`Workspace: ${workspace.name} (${workspace.id})`);

    const distPath = getDistDir();
    fs.mkdirSync(distPath, { recursive: true });
    const manifestPath = path.join(distPath, "manifest.cue");

    const manifest: {
      Apps: any[];
      Kind: string;
      Services: any[];
      Auths: any[];
      Pipelines: any[];
      Executors: any[];
      Stateflows: any[];
      Tailordbs: any[];
    } = {
      Apps: [],
      Kind: "workspace",
      Services: [],
      Auths: [],
      Pipelines: [],
      Executors: [],
      Stateflows: [],
      Tailordbs: [],
    };

    for (const app of this.applications) {
      manifest.Apps.push(app.toManifestJSON());

      for (const db of app.tailorDBServices) {
        await db.loadTypes();
        const tailordbManifest = db.toManifestJSON();
        manifest.Services.push(tailordbManifest);
        manifest.Tailordbs.push(tailordbManifest);
      }

      for (const pipeline of app.pipelineResolverServices) {
        await pipeline.build();
        await pipeline.loadResolvers();
        const pipelineManifest = await pipeline.toManifestJSON();
        manifest.Services.push(pipelineManifest);
        manifest.Pipelines.push(pipelineManifest);
      }

      if (app.authService) {
        const authManifest = app.authService.toManifest();
        manifest.Services.push(authManifest);
        manifest.Auths.push(authManifest);
      }
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Generated manifest.cue at ${manifestPath}`);

    if (!options.dryRun) {
      await client.apply(manifestPath);
    }
  }
}

export function defineWorkspace(config: WorkspaceConfig) {
  const workspace = new Workspace(config);
  Object.entries(config.app).forEach(([name, appConfig]) =>
    workspace.newApplication(name, appConfig),
  );
  return workspace;
}

export function apply(config: WorkspaceConfig, options: ApplyOptions) {
  return defineWorkspace(config).apply(options);
}
