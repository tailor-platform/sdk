export interface TriggerTarget {
  kind: "job" | "workflow";
  name: string;
}

export interface TriggerModuleBindings {
  localBindings: Map<string, TriggerTarget>;
  exports: Map<string, TriggerTarget>;
}

export interface TriggerModuleResolution {
  baseUrl: string;
  paths: Record<string, string[]>;
}

export interface TriggerContext {
  modules: Map<string, TriggerModuleBindings>;
  moduleResolution?: TriggerModuleResolution;
  authNamespace?: string;
}
