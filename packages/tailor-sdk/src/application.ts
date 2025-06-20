import { PipelineResolverService } from "./services/pipeline/service";
import { PipelineResolverServiceInput } from "./services/pipeline/types";
import { TailorDBService } from "./services/tailordb/service";
import { TailorDBServiceInput } from "./services/tailordb/types";
import { AuthService } from "./services/auth/service";
import { AuthReference, AuthServiceInput } from "./services/auth/types";
import { measure } from "./performance";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _pipelineResolverServices: PipelineResolverService[] = [];
  private _authService?: AuthService = undefined;
  private _subgraphs: Array<{ Type: string; Name: string }> = [];

  constructor(public name: string) {}

  private addSubgraph(type: string, name: string) {
    this._subgraphs.push({ Type: type, Name: name });
  }

  get tailorDBServices() {
    return this._tailorDBServices as ReadonlyArray<TailorDBService>;
  }

  get pipelineResolverServices() {
    return this
      ._pipelineResolverServices as ReadonlyArray<PipelineResolverService>;
  }

  get authService() {
    return this._authService as Readonly<AuthService>;
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
  defineResolver(config: PipelineResolverServiceInput) {
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
  }

  toManifestJSON() {
    let authReference: AuthReference | object = {};

    if (this._authService) {
      const namespace = this._authService.config.namespace;

      const idProviderConfigs = this._authService.config.idProviderConfigs;
      if (idProviderConfigs && idProviderConfigs.length > 0) {
        authReference = {
          Namespace: namespace,
          IdProviderConfigName: idProviderConfigs[0].Name,
        };
      }
    }

    return {
      Kind: "application",
      Name: this.name,
      Cors: [],
      AllowedIPAddresses: [],
      DisableIntrospection: false,
      Auth: authReference,
      Subgraphs: this._subgraphs,
      Version: "v2",
    };
  }
}
