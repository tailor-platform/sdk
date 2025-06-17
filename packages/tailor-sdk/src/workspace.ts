import path from "node:path";
import fs from "node:fs";
import { SchemaGenerator } from "./schema-generator";
import { SDLTypeMetadata } from "./types/types";
import type { output as _output } from "./types/helpers";
import { PipelineResolverService } from "./services/pipeline/service";
import { PipelineResolverServiceInput } from "./services/pipeline/types";
import { TailorDBService } from "./services/tailordb/service";
import { TailorDBServiceInput } from "./services/tailordb/types";
import { measure } from "./performance";
import gql from "multiline-ts";
import { OperatorClient } from "./client";
import { getDistPath } from "./tailor";

export class Workspace {
  private applications: Application[] = [];
  private tailorDBServices: TailorDBService[] = [];
  private pipelineResolverServices: PipelineResolverService[] = [];

  constructor(public name: string) {}

  @measure
  newApplication(name: string) {
    const app = new Application(name);
    this.applications.push(app);
    return app;
  }

  @measure
  defineTailorDBService(config: TailorDBServiceInput) {
    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const tailorDB = new TailorDBService(namespace, serviceConfig);
      this.tailorDBServices.push(tailorDB);
    }
  }

  @measure
  defineResolverService(config: PipelineResolverServiceInput) {
    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const pipelineService = new PipelineResolverService(
        namespace,
        serviceConfig,
      );
      this.pipelineResolverServices.push(pipelineService);
    }
  }

  @measure
  async ctlApply() {
    const client = new OperatorClient();
    const workspace = await client.upsertWorkspace({
      name: this.name,
      region: "asia-northeast",
    });
    console.log(`Workspace: ${workspace.name} (${workspace.id})`);

    const distPath = getDistPath();
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

    for (const db of this.tailorDBServices) {
      await db.apply(); // 型情報をロード
      const tailordbManifest = db.toManifestJSON();
      manifest.Services.push(tailordbManifest);
      manifest.Tailordbs.push(tailordbManifest);
    }

    for (const pipeline of this.pipelineResolverServices) {
      await pipeline.build(); // Resolverをロード
      const pipelineManifest = pipeline.toManifestJSON();
      manifest.Services.push(pipelineManifest);
      manifest.Pipelines.push(pipelineManifest);
    }

    for (const app of this.applications) {
      for (const db of this.tailorDBServices) {
        app.addSubgraph("tailordb", db.namespace);
      }
      for (const pipeline of this.pipelineResolverServices) {
        app.addSubgraph("pipeline", pipeline.namespace);
      }

      manifest.Apps.push(app.toManifestJSON());
    }

    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`Generated manifest.cue at ${manifestPath}`);

    client.apply(manifestPath);
  }

  @measure
  async apply() {
    console.log("Applying workspace:", this.name);
    console.log("Applications:", this.applications.map((app) => app.name));

    const distPath = getDistPath();
    const tailorDBDir = path.join(distPath, "tailordb");
    fs.mkdirSync(tailorDBDir, { recursive: true });

    const metadataList: SDLTypeMetadata[] = [];
    for (const db of this.tailorDBServices) {
      console.log("TailorDB Service:", db.namespace);

      await db.apply();

      db.getTypes().forEach((type) => {
        metadataList.push(type.toSDLMetadata());
        fs.writeFileSync(
          path.join(tailorDBDir, `${type.metadata.name}.json`),
          JSON.stringify(type.metadata, null, 2),
        );
      });
    }

    const tailorDBSDL = SchemaGenerator.generateSDL(metadataList);

    console.log(
      "Pipeline Services:",
      this.pipelineResolverServices.map((service) => service.namespace),
    );

    const resolverMetadataList: Array<{ name: string; sdl: string }> = [];
    for (const pipelineService of this.pipelineResolverServices) {
      await pipelineService.build();

      const resolverMetadata = pipelineService.getResolverSDLMetadata();
      for (const metadata of resolverMetadata) {
        resolverMetadataList.push({
          name: metadata.name,
          sdl: metadata.sdl,
        });
      }
    }

    const combinedSDL = gql`
    # TailorDB Type
    ${tailorDBSDL}

    ${
      resolverMetadataList.map((metadata) =>
        gql`
        # Resolver: ${metadata.name}
        ${metadata.sdl}
        `
      ).join("\n\n\n")
    }

    `;
    fs.writeFileSync(path.join(distPath, "schema.graphql"), combinedSDL);
  }
}

export class Application {
  private subgraphs: Array<{ Type: string; Name: string }> = [];

  constructor(public name: string) {}

  addSubgraph(type: string, name: string) {
    this.subgraphs.push({ Type: type, Name: name });
  }

  toManifestJSON() {
    return {
      Kind: "application",
      Name: this.name,
      Cors: [],
      AllowedIPAddresses: [],
      DisableIntrospection: false,
      Auth: {},
      Subgraphs: this.subgraphs,
      Version: "v2",
    };
  }
}
