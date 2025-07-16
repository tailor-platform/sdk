import { PipelineResolverService } from "@/services/pipeline/service";
import { PipelineResolverServiceInput } from "@/services/pipeline/types";
import { TailorDBService } from "@/services/tailordb/service";
import { TailorDBServiceInput } from "@/services/tailordb/types";
import { AuthService } from "@/services/auth/service";
import { AuthServiceInput } from "@/services/auth/types";
import { measure } from "@/performance";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _pipelineResolverServices: PipelineResolverService[] = [];
  private _authService?: AuthService = undefined;
  private _subgraphs: Array<{ Type: string; Name: string }> = [];

  constructor(public name: string) {}

  private addSubgraph(type: string, name: string) {
    this._subgraphs.push({ Type: type, Name: name });
  }

  get subgraphs() {
    return this._subgraphs as ReadonlyArray<{ Type: string; Name: string }>;
  }

  get tailorDBServices() {
    return this._tailorDBServices as ReadonlyArray<TailorDBService>;
  }

  get pipelineResolverServices() {
    return this
      ._pipelineResolverServices as ReadonlyArray<PipelineResolverService>;
  }

  get authService() {
    return this._authService as Readonly<AuthService> | undefined;
  }

  @measure
  defineTailorDB(config: TailorDBServiceInput) {
    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const tailorDB = new TailorDBService(namespace, serviceConfig);
      this._tailorDBServices.push(tailorDB);
      this.addSubgraph("tailordb", tailorDB.namespace);
    }
  }

  @measure
  definePipeline(config: PipelineResolverServiceInput) {
    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const pipelineService = new PipelineResolverService(
        namespace,
        serviceConfig,
      );
      this._pipelineResolverServices.push(pipelineService);
      this.addSubgraph("pipeline", pipelineService.namespace);
    }
  }

  @measure
  defineAuth(config: AuthServiceInput) {
    const authService = new AuthService(config);
    this._authService = authService;
    this.addSubgraph("auth", authService.config.namespace);
  }
}
