import { PipelineResolverService } from "./services/pipeline/service";
import { PipelineResolverServiceInput } from "./services/pipeline/types";
import { TailorDBService } from "./services/tailordb/service";
import { TailorDBServiceInput } from "./services/tailordb/types";
import { measure } from "./performance";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _pipelineResolverServices: PipelineResolverService[] = [];
  private _subgraphs: Array<{ Type: string; Name: string }> = [];

  constructor(public name: string) {}

  private addSubgraph(type: string, name: string) {
    this._subgraphs.push({ Type: type, Name: name });
  }

  get tailorDBServices() {
    return this._tailorDBServices as ReadonlyArray<TailorDBService>;
  }

  get pipelineResolverServices() {
    return this._pipelineResolverServices as ReadonlyArray<
      PipelineResolverService
    >;
  }

  @measure
  defineTailorDBService(config: TailorDBServiceInput) {
    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const tailorDB = new TailorDBService(namespace, serviceConfig);
      this._tailorDBServices.push(tailorDB);
      this.addSubgraph("tailordb", tailorDB.namespace);
    }
  }

  @measure
  defineResolverService(config: PipelineResolverServiceInput) {
    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const pipelineService = new PipelineResolverService(
        namespace,
        serviceConfig,
      );
      this._pipelineResolverServices.push(pipelineService);
      this.addSubgraph("pipeline", pipelineService.namespace);
    }
  }

  toManifestJSON() {
    return {
      Kind: "application",
      Name: this.name,
      Cors: [],
      AllowedIPAddresses: [],
      DisableIntrospection: false,
      Auth: {},
      Subgraphs: this._subgraphs,
      Version: "v2",
    };
  }
}
