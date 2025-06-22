/* eslint-disable @typescript-eslint/no-explicit-any */

import path from "node:path";
import fs, { mkdirSync } from "node:fs";
import { SchemaGenerator } from "./schema-generator";
import { SDLTypeMetadata } from "./types/types";
import { measure } from "./performance";
import gql from "multiline-ts";
import { TailorCtl } from "./ctl";
import { Application } from "./application";
import { getDistDir, type WorkspaceConfig } from "./config";
import { ApplyOptions, GenerateOptions } from "./cli/args";

class Workspace {
  private applications: Application[] = [];

  constructor(public name: string) {}

  @measure
  newApplication(name: string) {
    const app = new Application(name);
    this.applications.push(app);
    return app;
  }

  @measure
  async apply(options: ApplyOptions) {
    const client = new TailorCtl(options);
    const workspace = await client.upsertWorkspace({
      name: this.name,
      region: "asia-northeast",
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
        const pipelineManifest = pipeline.toManifestJSON();
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
    console.log("Applying workspace:", this.name);
    console.log(
      "Applications:",
      this.applications.map((app) => app.name),
    );

    const baseDir = path.join(getDistDir(), "generated");
    mkdirSync(baseDir, { recursive: true });

    const tailordbMetadataList: SDLTypeMetadata[] = [];
    const resolverMetadataList: Array<{ name: string; sdl: string }> = [];
    for (const app of this.applications) {
      for (const db of app.tailorDBServices) {
        console.log("TailorDB Service:", db.namespace);

        await db.apply();

        db.getTypes().forEach((type) => {
          tailordbMetadataList.push(type.toSDLMetadata());
        });
      }

      console.log(
        "Pipeline Services:",
        app.pipelineResolverServices.map((service) => service.namespace),
      );

      for (const pipelineService of app.pipelineResolverServices) {
        const resolverMetadata = pipelineService.getResolverSDLMetadata();
        for (const metadata of resolverMetadata) {
          resolverMetadataList.push({
            name: metadata.name,
            sdl: metadata.sdl,
          });
        }
      }
    }

    const tailordbSDL = SchemaGenerator.generateSDL(tailordbMetadataList);
    const resolverSDL = resolverMetadataList
      .map(
        (metadata) =>
          gql`
        # Resolver: ${metadata.name}
        ${metadata.sdl}
        `,
      )
      .join("\n\n\n");
    const combinedSDL = gql`
      # TailorDB Type
      ${tailordbSDL}

      ${resolverSDL}
    `;
    fs.writeFileSync(path.join(baseDir, "schema.graphql"), combinedSDL);
  }
}

function defineWorkspace(config: WorkspaceConfig) {
  const workspace = new Workspace(config.name);
  const app = workspace.newApplication(config.app.name);
  app.defineTailorDB(config.app.db);
  app.defineResolver(config.app.resolver);
  app.defineAuth(config.app.auth);
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
