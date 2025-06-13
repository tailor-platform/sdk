import path from "node:path";
import fs from "node:fs";
import { SchemaGenerator } from "./schema-generator";
import { SDLTypeMetadata } from "./types/types";
import type { output as _output } from "./types/helpers";
import { PipelineResolverService } from "./pipeline/service";
import { PipelineResolverServiceInput } from "./pipeline/types";
import { TailorDBService } from "./tailordb/service";
import { TailorDBServiceInput } from "./tailordb/types";
import { measure } from "./performance";
import gql from "multiline-ts";

let distPath: string = "";
export const getDistPath = () => distPath;

export const Tailor = {
  init: (path: string) => {
    distPath = path;
    console.log("Tailor SDK initialized");
    console.log("path:", distPath);
  },
  newWorkspace: (name: string) => {
    return new Workspace(name);
  },
};

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
  async apply() {
    console.log("Applying workspace:", this.name);
    console.log("Applications:", this.applications.map((app) => app.name));

    // Ensure directories exist before writing files
    const tailorDBDir = path.join(distPath, "tailordb");
    fs.mkdirSync(tailorDBDir, { recursive: true });

    const metadataList: SDLTypeMetadata[] = [];
    for (const db of this.tailorDBServices) {
      console.log("TailorDB Service:", db.namespace);

      // Apply the TailorDB service (loads types from files if configured)
      await db.apply();

      db.getTypes().forEach((type) => {
        metadataList.push(type.toSDLMetadata());
        fs.writeFileSync(
          `${tailorDBDir}/${type.metadata.name}.json`,
          JSON.stringify(type.metadata, null, 2),
        );
      });
    }

    // Generate TailorDB SDL
    const tailorDBSDL = SchemaGenerator.generateSDL(metadataList);

    console.log(
      "Pipeline Services:",
      this.pipelineResolverServices.map((service) => service.namespace),
    );

    // Build pipeline services and collect resolver metadata
    const resolverMetadataList: Array<{ name: string; sdl: string }> = [];
    for (const pipelineService of this.pipelineResolverServices) {
      await pipelineService.build();

      // Get resolver SDL metadata
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
  constructor(public name: string) {
  }
  addSubgraph(subgraph: any) {}
}
