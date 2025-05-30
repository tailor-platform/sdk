import path from "node:path";
import fs from "node:fs";
import { generateSDL } from "./schema-generator";
import { SDLTypeMetadata } from "./types/types";
import type { output as _output } from "./types/helpers";
import { PipelineResolverService } from "./pipeline/service";
import { ResolverServiceConfig } from "./pipeline/types";
import { TailorDBService } from "./tailordb/service";
import { TailorDBServiceConfig } from "./tailordb/types";

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

  newApplication(name: string) {
    const app = new Application(name);
    this.applications.push(app);
    return app;
  }
  newTailorDBservice(nameOrConfig: string | TailorDBServiceConfig) {
    const config: TailorDBServiceConfig = typeof nameOrConfig === "string"
      ? { namespace: nameOrConfig }
      : nameOrConfig;

    const tailorDb = new TailorDBService(config);
    this.tailorDBServices.push(tailorDb);
    return tailorDb;
  }
  newResolverService(config: ResolverServiceConfig) {
    const pipelineService = new PipelineResolverService(config);
    this.pipelineResolverServices.push(pipelineService);
    return pipelineService;
  }
  async apply() {
    console.log("Applying workspace:", this.name);
    console.log("Applications:", this.applications.map((app) => app.name));

    // Ensure directories exist before writing files
    const tailorDBDir = path.join(distPath, "tailordb");
    fs.mkdirSync(tailorDBDir, { recursive: true });

    const metadataList: SDLTypeMetadata[] = [];
    for (const db of this.tailorDBServices) {
      console.log("TailorDB Service:", db.config.namespace);

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

    const sdl = generateSDL(metadataList);
    fs.writeFileSync(path.join(distPath, "schema.graphql"), sdl);

    console.log(
      "Pipeline Services:",
      this.pipelineResolverServices.map((service) => service.name),
    );

    // Build pipeline services
    for (const pipelineService of this.pipelineResolverServices) {
      await pipelineService.build();
    }
  }
}

export class Application {
  constructor(public name: string) {
  }
  addSubgraph(subgraph: any) {
  }
}
