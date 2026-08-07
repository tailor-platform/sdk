import type { NormalizedSchemaSnapshot } from "#/cli/commands/tailordb/migrate/snapshot";
import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { DependentAppsByResource } from "./label";
import type { ApplyPhase } from "./phase";

export type { ApplyPhase };

export interface TailorDBMigrationTestBaseline {
  migrationNumber: number;
  snapshot: NormalizedSchemaSnapshot;
}

export type TailorDBMigrationTestSnapshots = ReadonlyMap<string, NormalizedSchemaSnapshot>;

export interface PlanContext {
  client: OperatorClient;
  workspaceId: string;
  application: Readonly<Application>;
  forRemoval: boolean;
  config: LoadedConfig;
  noSchemaCheck?: boolean;
  forceApplyAll?: boolean;
  /**
   * Set of IdP names that have at least one executor with an idpUser trigger.
   * Controls how `publishEvents` defaults on each IdP service. Empty when
   * no idpUser triggers are defined.
   */
  idpUserTriggerTargets?: ReadonlySet<string>;
  /** Type names that have at least one executor with a TailorDB record trigger. */
  executorUsedTailorDBTypes?: ReadonlySet<string>;
  /** Resolver names that have at least one executor with a resolverExecuted trigger. */
  executorUsedResolvers?: ReadonlySet<string>;
  /** Static website names planned by any config in the same deploy run. */
  expectedLocalStaticWebsiteNames?: ReadonlySet<string>;
  /** Planned external Auth IDP config names keyed by Auth namespace. */
  externalAuthIdpConfigNames?: ReadonlyMap<string, string | undefined>;
  /** TailorDB namespaces keyed by type name for same-run external trigger resolution. */
  tailorDBTypeNamespaces?: ReadonlyMap<string, string | undefined>;
  /** Pipeline namespaces keyed by resolver name for same-run external trigger resolution. */
  resolverNamespaces?: ReadonlyMap<string, string | undefined>;
  /** IdP names known to the current deploy run. */
  idpNames?: ReadonlySet<string>;
  /** Stable ids of every application taking part in the current deploy run. */
  runAppIds?: ReadonlySet<string>;
  /**
   * Applications that have to take part in the same deploy for this config's
   * resources to be applied the same way, keyed by resource.
   *
   * A planner looks up the resource it is applying and folds the result into that
   * resource's own labels, so a record lives on the thing whose `publishEvents`
   * is at stake rather than on the application.
   */
  dependentApps?: DependentAppsByResource;
  /**
   * Baseline snapshots used internally by `tailordb migration test`. Consumed
   * by TailorDB planning only; other plan modules receive an `application`
   * already adjusted for the migration test deploy by the deploy pipeline.
   */
  migrationTestBaselines?: ReadonlyMap<string, TailorDBMigrationTestBaseline>;
  /** Committed schema snapshots used internally by `tailordb migration test`. Consumed by TailorDB planning only. */
  migrationTestSnapshots?: TailorDBMigrationTestSnapshots;
}
