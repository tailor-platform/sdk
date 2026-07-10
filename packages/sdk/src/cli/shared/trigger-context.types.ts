export interface TriggerTarget {
  kind: "job" | "workflow";
  name: string;
}

export interface TriggerModuleBindings {
  localBindings: Map<string, TriggerTarget>;
  exports: Map<string, TriggerTarget>;
}

export type TriggerModuleResolution = TsConfigResult;

export interface TriggerContext {
  modules: Map<string, TriggerModuleBindings>;
  moduleResolution?: TriggerModuleResolution;
  authNamespace?: string;
}
import type { TsConfigResult } from "get-tsconfig";
