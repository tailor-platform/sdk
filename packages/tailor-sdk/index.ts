import { PipelineResolverService } from "./pipeline";
import {
  getTailorDBTypeMetadata,
  isDBType,
  TailorDBDef,
} from "./tailordb";
import * as fs from "fs";
import { generateSDL } from "./schema-generator";
import { TypeMetadata } from "./types";
import type { output as _output } from "./types/helpers";

export * from "./pipeline";
export * from "./schema-generator";
export * from "./tailordb/decorator";
export { db } from "./tailordb";

export { _output as infer, _output as output };
export namespace t {
  export type output<T> = _output<T>;
  export type infer<T> = _output<T>;
}

let basePath: string = "";

export const getBasePath = () => basePath;

export const Tailor = {
  init: (path: string) => {
    basePath = path;
    console.log("Tailor SDK initialized");
    console.log("path:", basePath);
  },
  newWorkspace: (name: string) => {
    return new Workspace(name);
  },
};

export class Workspace {
  private applications: Application[] = [];
  private tailorDBServices: TailorDBService[] = [];
  private pipelineResolverServices: PipelineResolverService[] = [];
  constructor(public name: string) { }

  newApplication(name: string) {
    const app = new Application(name);
    this.applications.push(app);
    return app;
  }
  newTailorDBservice(name: string) {
    const tailorDb = new TailorDBService(name, "default");
    this.tailorDBServices.push(tailorDb);
    return tailorDb;
  }
  newResolverService(name: string) {
    const pipelineService = new PipelineResolverService(name);
    this.pipelineResolverServices.push(pipelineService);
    return pipelineService;
  }
  async apply() {
    console.log("Applying workspace:", this.name);
    console.log("Applications:", this.applications.map((app) => app.name));

    // Ensure directories exist before writing files
    const tailorDBDir = `${basePath}/dist/tailordb`;
    fs.mkdirSync(tailorDBDir, { recursive: true });

    const objectStyleMetadataList: TypeMetadata[] = [];
    this.tailorDBServices.forEach((db) => {
      console.log("TailorDB Service:", db.workspace);
      db.getTypes().forEach((type) => {
        const meta = isDBType(type)
          ? type.metadata
          : getTailorDBTypeMetadata(type);
        if (isDBType(type)) {
          objectStyleMetadataList.push(type.toSDLMetadata());
        }
        fs.writeFileSync(
          `${tailorDBDir}/${meta.name}.json`,
          JSON.stringify(meta, null, 2),
        );
      });
      // Here you would implement the logic to apply the TailorDB service
    });

    const sdl = generateSDL(objectStyleMetadataList);
    fs.writeFileSync(`${basePath}/dist/schema.graphql`, sdl);

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

export class TailorDBService {
  private types: any[] = [];
  constructor(public workspace: string, public namespace: string) {
  }
  addTailorDBType(type: Function | TailorDBDef) {
    this.types.push(type);
  }
  getTypes() {
    return this.types;
  }
}
