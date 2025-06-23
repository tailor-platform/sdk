/* eslint-disable @typescript-eslint/no-explicit-any */
import path from "node:path";
import fs, { mkdirSync } from "node:fs";
import { measure } from "./performance";
import { TailorCtl } from "./ctl";
import { Application } from "./application";
import { AppConfig, getDistDir, type WorkspaceConfig } from "./config";
import { ApplyOptions, GenerateOptions } from "./cli/args";
import { sdlGenerator } from "./generator/sdl";
import { TailorDBType } from "./services/tailordb/schema";
import { Resolver } from "./services/pipeline/resolver";
import { CodeGenerator } from "./generator/types";

class Workspace {
  private applications: Application[] = [];

  constructor(public readonly config: WorkspaceConfig) {}

  @measure
  newApplication(name: string, appConfig: AppConfig) {
    const app = new Application(name);
    app.defineAuth(appConfig.auth);
    app.defineTailorDB(appConfig.db);
    app.defineResolver(appConfig.resolver);

    this.applications.push(app);
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
        await db.apply();
        const tailordbManifest = db.toManifestJSON();
        manifest.Services.push(tailordbManifest);
        manifest.Tailordbs.push(tailordbManifest);
      }

      for (const pipeline of app.pipelineResolverServices) {
        await pipeline.build();
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

  @measure
  async generate() {
    console.log("Applying workspace:", this.config.name);
    console.log(
      "Applications:",
      this.applications.map((app) => app.name),
    );

    const baseDir = path.join(getDistDir(), "generated");
    mkdirSync(baseDir, { recursive: true });

    const tailordbTypes: TailorDBType[] = [];
    const resolvers: Resolver[] = [];

    for (const app of this.applications) {
      for (const db of app.tailorDBServices) {
        console.log("TailorDB Service:", db.namespace);
        await db.apply();
        tailordbTypes.push(...db.getTypes());
      }

      console.log(
        "Pipeline Services:",
        app.pipelineResolverServices.map((service) => service.namespace),
      );
      for (const pipelineService of app.pipelineResolverServices) {
        await pipelineService.build(); // Resolverを読み込むためにbuild()を呼び出す
        resolvers.push(...pipelineService.getResolvers());
      }
    }

    this.processGenerators(baseDir, tailordbTypes, resolvers);
  }

  async processGenerators(
    baseDir: string,
    types: TailorDBType[],
    resolvers: Resolver[],
  ) {
    const generators: CodeGenerator<any, any>[] = [sdlGenerator];
    await Promise.all(
      generators.map(async (gen) => {
        let typeResults: any = {};
        let resolverResults: any = {};

        for (const type of types) {
          typeResults[type.name] = await gen.processType(type);
        }
        if (gen.processTypes) {
          typeResults = await gen.processTypes(typeResults);
        }

        for (const resolver of resolvers) {
          resolverResults[resolver.name] = await gen.processResolver(resolver);
        }
        if (gen.processResolvers) {
          resolverResults = await gen.processResolvers(resolverResults);
        }

        const result = await gen.aggregate(
          { types: typeResults, resolvers: resolverResults },
          path.join(baseDir, gen.id),
        );
        Promise.all(
          result.files.map(async (file) => {
            mkdirSync(path.dirname(file.path), { recursive: true });
            fs.writeFile(file.path, file.content, (err) => {
              if (err) {
                console.error(`Error writing file ${file.path}:`, err);
              } else {
                console.log(`Generated file: ${file.path}`);
              }
            });
          }),
        );
      }),
    );
  }
}

function defineWorkspace(config: WorkspaceConfig) {
  const workspace = new Workspace(config);
  Object.entries(config.app).forEach(([name, appConfig]) =>
    workspace.newApplication(name, appConfig),
  );
  return workspace;
}

export function generate(
  config: WorkspaceConfig,
  _options: GenerateOptions = {},
) {
  return defineWorkspace(config).generate();
}

export function apply(config: WorkspaceConfig, options: ApplyOptions = {}) {
  return defineWorkspace(config).apply(options);
}
