import path from "node:path";
import { BasicGeneratorMetadata, GeneratorResult } from "../../types";
import {
  ManifestTypeMetadata,
  WorkspaceManifest,
  ExecutorManifest,
  AuthManifest,
  TailordbManifest,
  PipelineManifest,
} from "./types";
import { ResolverManifestMetadata } from "./resolver-processor";
import { ExecutorManifestMetadata } from "./executor-processor";
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
  static async aggregate(
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    > & { executors: ExecutorManifestMetadata[] },
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
            content:
              JSON.stringify(
                manifestJSON,
                (key, value) => {
                  // BigIntを数値に変換
                  if (typeof value === "bigint") {
                    return Number(value);
                  }
                  return value;
                },
                2,
              ) + "\n",
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
  private static async generateWorkspaceManifest(
    workspace: Workspace,
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    > & { executors: ExecutorManifestMetadata[] },
  ): Promise<WorkspaceManifest> {
    const manifest: WorkspaceManifest = {
      Apps: [],
      Kind: "workspace",
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
          metadata.executors,
        );
        manifest.Tailordbs.push(tailordbManifest);
      }

      for (const pipeline of app.pipelineResolverServices) {
        await pipeline.build();
        await pipeline.getResolvers();
        const pipelineManifest = ManifestAggregator.generatePipelineManifest(
          pipeline,
          metadata,
          metadata.executors,
        );
        manifest.Pipelines.push(pipelineManifest);
      }

      if (app.authService) {
        const authManifest = ManifestAggregator.generateAuthManifest(
          app.authService,
        );
        manifest.Auths.push(authManifest);
      }
    }

    // Build executor service if it exists
    if (workspace.executorService) {
      await workspace.executorService.build();
    }

    // Process executors from metadata
    if (metadata.executors && metadata.executors.length > 0) {
      // Group executors by namespace (from their original service)
      const serviceExecutors = metadata.executors.filter(() => {
        // Match executors to their service by checking workspace
        return true; // For now, we'll include all executors
      });
      // Create executor manifests for each namespace
      const executorManifest =
        ManifestAggregator.generateExecutorManifestFromMetadata(
          serviceExecutors,
        );
      manifest.Executors.push(executorManifest);
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
  static generatePipelineManifest(
    service: PipelineResolverService,
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
    executors?: ExecutorManifestMetadata[],
  ): PipelineManifest {
    // usedResolverNamesを収集
    const usedResolverNames = new Set<string>();
    if (executors) {
      for (const executor of executors) {
        if (executor.usedResolverName) {
          usedResolverNames.add(executor.usedResolverName);
        }
      }
    }

    const resolverManifests = Object.entries(metadata.resolvers)
      .filter(([_, resolverMetadata]) => resolverMetadata != null)
      .map(([_, resolverMetadata]) => {
        const resolverManifest = { ...resolverMetadata.resolverManifest };

        // リゾルバーが使用されている場合、PublishExecutionEventsをtrueに設定
        if (usedResolverNames.has(resolverManifest.Name)) {
          resolverManifest.PublishExecutionEvents = true;
        }

        return resolverManifest;
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
  static generateTailorDBManifest(
    service: TailorDBService,
    metadata: BasicGeneratorMetadata<
      ManifestTypeMetadata,
      ResolverManifestMetadata
    >,
    executors?: ExecutorManifestMetadata[],
  ): TailordbManifest {
    const usedTypeNames = new Set<string>();
    const usedResolverNames = new Set<string>();
    if (executors) {
      for (const executor of executors) {
        if (executor.usedTailorDBType) {
          usedTypeNames.add(executor.usedTailorDBType);
        }
        if (executor.usedResolverName) {
          usedResolverNames.add(executor.usedResolverName);
        }
      }
    }

    const types = Object.values(metadata.types)
      .filter((typeMetadata) => typeMetadata != null)
      .map((typeMetadata) => {
        const typeManifest = { ...typeMetadata.typeManifest };

        if (usedTypeNames.has(typeManifest.Name)) {
          typeManifest.Settings = {
            ...typeManifest.Settings,
            PublishRecordEvents: true,
          };
        }

        return typeManifest;
      });

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
  static generateAuthManifest(service: AuthService): AuthManifest {
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

  /**
   * ExecutorManifestMetadataからManifest JSON生成
   */
  static generateExecutorManifestFromMetadata(
    executors: ExecutorManifestMetadata[],
  ): ExecutorManifest {
    const executorManifests = executors
      .filter(
        (
          e,
        ): e is ExecutorManifestMetadata & {
          executorManifest: NonNullable<
            ExecutorManifestMetadata["executorManifest"]
          >;
        } => e.executorManifest != null,
      )
      .map((e) => e.executorManifest);

    return {
      Kind: "executor",
      Executors: executorManifests,
      Version: "v2",
    };
  }
}
