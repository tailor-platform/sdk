import path from "node:path";
import { BasicGeneratorMetadata, GeneratorResult } from "../../types";
import {
  ManifestTypeMetadata,
  WorkspaceManifest,
  ServiceManifest,
} from "./types";
import { ResolverManifestMetadata } from "./resolver-processor";
import { measure } from "@/performance";
import { getDistDir } from "@/config";
import type { Workspace } from "@/workspace";
import { AuthReference } from "@/services/auth";
import { AuthService } from "@/services/auth/service";
import { IdProviderConfig } from "@/services/auth/types";
import { TailorDBService } from "@/services/tailordb/service";
import { PipelineResolverService } from "@/services/pipeline/service";

/**
 * Manifest統合ロジック
 * 複数のManifest断片の統合、JSON生成を担当
 */
export class ManifestAggregator {
  /**
   * Workspace全体のManifestを生成してファイルに出力
   */
  @measure
  static async aggregate(
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
    workspace: Workspace,
  ): Promise<GeneratorResult> {
    try {
      const manifestJSON = await ManifestAggregator.generateWorkspaceManifest(
        workspace,
        metadata,
      );

      return {
        files: [
          {
            path: path.join(getDistDir(), "manifest.cue"),
            content: JSON.stringify(manifestJSON, null, 2) + "\n",
          },
        ],
      };
    } catch (error) {
      return {
        files: [],
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * WorkspaceからManifest全体を生成
   */
  @measure
  private static async generateWorkspaceManifest(
    workspace: Workspace,
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
  ): Promise<WorkspaceManifest> {
    const manifest: WorkspaceManifest = {
      Apps: [],
      Kind: "workspace",
      Services: [],
      Auths: [],
      Pipelines: [],
      Executors: [],
      Stateflows: [],
      Tailordbs: [],
    };

    for (const app of workspace.applications) {
      manifest.Apps.push(ManifestAggregator.generateAppManifest(app));

      for (const db of app.tailorDBServices) {
        await db.loadTypes();
        const tailordbManifest = ManifestAggregator.generateTailorDBManifest(
          db,
          metadata,
        );
        manifest.Services.push(tailordbManifest);
        manifest.Tailordbs.push(tailordbManifest);
      }

      for (const pipeline of app.pipelineResolverServices) {
        await pipeline.build();
        await pipeline.loadResolvers();
        const pipelineManifest =
          await ManifestAggregator.generatePipelineManifest(pipeline, metadata);
        manifest.Services.push(pipelineManifest as unknown as ServiceManifest);
        manifest.Pipelines.push(pipelineManifest);
      }

      if (app.authService) {
        const authManifest = ManifestAggregator.generateAuthManifest(
          app.authService,
        );
        manifest.Services.push(authManifest);
        manifest.Auths.push(authManifest);
      }
    }

    return manifest;
  }

  private static generateAppManifest(app: Workspace["applications"][number]) {
    let authReference: AuthReference | null = null;

    if (app.authService && app.authService.config) {
      const namespace = app.authService.config.namespace;

      const idProviderConfigs = app.authService.config.idProviderConfigs;
      if (idProviderConfigs && idProviderConfigs.length > 0) {
        authReference = {
          Namespace: namespace,
          IdProviderConfigName: idProviderConfigs[0].Name,
        };
      }
    }

    return {
      Kind: "application",
      Name: app.name,
      Cors: [],
      AllowedIPAddresses: [],
      DisableIntrospection: false,
      Auth: authReference ?? {},
      Subgraphs: app.subgraphs,
      Version: "v2",
    };
  }

  /**
   * PipelineResolverServiceからManifest JSON生成
   * metadataから既に生成されたマニフェストを使用する純粋な統合処理
   */
  @measure
  static async generatePipelineManifest(
    service: PipelineResolverService,
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
  ) {
    const resolverManifests = Object.entries(metadata.resolvers)
      .filter(([_, resolverMetadata]) => resolverMetadata != null)
      .map(([_, resolverMetadata]) => {
        return resolverMetadata.resolverManifest;
      });

    return {
      Kind: "pipeline",
      Description: "",
      Namespace: service.namespace,
      Resolvers: resolverManifests,
      Version: "v2",
    };
  }

  /**
   * TailorDBServiceからManifest JSON生成
   * metadataから既に生成されたマニフェストを使用する純粋な統合処理
   */
  @measure
  static generateTailorDBManifest(
    service: TailorDBService,
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
  ): any {
    const types = Object.values(metadata.types)
      .filter((typeMetadata) => typeMetadata != null)
      .map((typeMetadata) => typeMetadata.typeManifest);

    return {
      Kind: "tailordb",
      Namespace: service.namespace,
      Types: types,
      Version: "v2",
    };
  }

  /**
   * AuthServiceからManifest JSON生成
   */
  @measure
  static generateAuthManifest(service: AuthService): any {
    return {
      Kind: "auth",
      Namespace: service.config.namespace,
      IdProviderConfigs: service.config.idProviderConfigs?.map(
        (provider: IdProviderConfig) => {
          const baseConfig = { Name: provider.Name };
          switch (provider.Config.Kind) {
            case "IDToken":
              return { ...baseConfig, IdTokenConfig: provider.Config };
            case "SAML":
              return { ...baseConfig, SamlConfig: provider.Config };
            case "OIDC":
              return { ...baseConfig, OidcConfig: provider.Config };
            default:
              throw new Error(
                `Unknown IdProviderConfig kind: ${provider.Config satisfies never}`,
              );
          }
        },
      ),
      UserProfileProvider: service.config.userProfileProvider,
      UserProfileProviderConfig: service.config.userProfileProviderConfig,
      SCIMConfig: service.config.scimConfig || null,
      TenantProvider: service.config.tenantProvider || "",
      TenantProviderConfig: service.config.tenantProviderConfig || null,
      MachineUsers: service.config.machineUsers,
      OAuth2Clients: service.config.oauth2Clients || [],
      Version: service.config.version,
    };
  }
}
