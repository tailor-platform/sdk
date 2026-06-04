import type { ApplyPhase } from "./phase";
import type { Application } from "@/cli/services/application";
import type { OperatorClient } from "@/cli/shared/client";
import type { LoadedConfig } from "@/cli/shared/config-loader";

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
}
