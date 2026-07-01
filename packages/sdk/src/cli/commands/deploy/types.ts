import type { Application } from "#/cli/services/application";
import type { OperatorClient } from "#/cli/shared/client";
import type { LoadedConfig } from "#/cli/shared/config-loader";
import type { ApplyPhase } from "./phase";

export type { ApplyPhase };

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
   * Controls how `publishUserEvents` defaults on each IdP service. Empty when
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
}
