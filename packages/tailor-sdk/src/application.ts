import { PipelineResolverService } from "@/services/pipeline/service";
import { PipelineResolverServiceInput } from "@/services/pipeline/types";
import { TailorDBService } from "@/services/tailordb/service";
import { TailorDBServiceInput } from "@/services/tailordb/types";
import { AuthService } from "@/services/auth/service";
import { AuthServiceInput } from "@/services/auth/types";
import { IdPServiceInput } from "./services/idp/types";
import { AppConfig } from "./config";

export class Application {
  private _tailorDBServices: TailorDBService[] = [];
  private _pipelineResolverServices: PipelineResolverService[] = [];
  private _idpService?: IdPServiceInput = {};
  private _authService?: AuthService = undefined;
  private _subgraphs: Array<{ Type: string; Name: string }> = [];

  constructor(
    public readonly name: string,
    public readonly config: Pick<
      AppConfig,
      "cors" | "allowedIPAddresses" | "disableIntrospection"
    >,
  ) {}

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

  get idpServices() {
    return this._idpService as Readonly<IdPServiceInput>;
  }

  get authService() {
    return this._authService as Readonly<AuthService> | undefined;
  }

  defineTailorDB(config?: TailorDBServiceInput) {
    if (!config) {
      return;
    }

    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const tailorDB = new TailorDBService(namespace, serviceConfig);
      this._tailorDBServices.push(tailorDB);
      this.addSubgraph("tailordb", tailorDB.namespace);
    }
  }

  definePipeline(config?: PipelineResolverServiceInput) {
    if (!config) {
      return;
    }

    for (const [namespace, serviceConfig] of Object.entries(config)) {
      const pipelineService = new PipelineResolverService(
        namespace,
        serviceConfig,
      );
      this._pipelineResolverServices.push(pipelineService);
      this.addSubgraph("pipeline", pipelineService.namespace);
    }
  }

  defineIdp(config?: IdPServiceInput) {
    if (!config) {
      return;
    }

    this._idpService = config;
    Object.keys(config).forEach((namespace) =>
      this.addSubgraph("idp", namespace),
    );
  }

  defineAuth(config?: AuthServiceInput) {
    if (!config) {
      return;
    }

    const authService = new AuthService(config);
    this._authService = authService;
    this.addSubgraph("auth", authService.config.namespace);
  }
}
