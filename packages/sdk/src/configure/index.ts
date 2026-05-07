import { t as _t } from "@/configure/types";
import type * as helperTypes from "@/types/helpers";

/**
 * Re-exported so the bundled `.d.mts` keeps a value-level reference to
 * `@/runtime/globals`, which forces the rolldown dts emitter to include the
 * vendored ambient `tailor.*` / `tailordb` declarations alongside the SDK
 * main entry. Importing anything from `@tailor-platform/sdk` therefore
 * activates those globals automatically.
 * @internal
 */
export { __TAILOR_RUNTIME_GLOBALS_LOADED__ } from "@/runtime/globals";

type TailorOutput<T> = helperTypes.output<T>;

export type infer<T> = TailorOutput<T>;
export type output<T> = TailorOutput<T>;

/** TailorDB field type builders. */
// eslint-disable-next-line import-x/export
export const t = { ..._t };
// eslint-disable-next-line @typescript-eslint/no-namespace, import-x/export
export namespace t {
  export type output<T> = TailorOutput<T>;
  export type infer<T> = TailorOutput<T>;
}

export { type TailorField } from "@/configure/types/type";
export {
  type TailorUser,
  type TailorInvoker,
  unauthenticatedTailorUser,
  type AttributeMap,
  type AttributeList,
} from "@/types/user";
export { type Env } from "@/types/env";
export { type MachineUserNameRegistry, type MachineUserName } from "@/configure/types/machine-user";
export { type IdpNameRegistry, type IdpName } from "@/configure/types/idp-name";

export * from "@/configure/services";

export { defineConfig, defineGenerators, definePlugins } from "@/configure/config";

// Plugin types for custom plugin development
export type {
  Plugin,
  PluginConfigs,
  PluginOutput,
  TypePluginOutput,
  NamespacePluginOutput,
  PluginProcessContext,
  PluginNamespaceProcessContext,
  PluginAttachment,
  PluginGeneratedType,
  PluginGeneratedResolver,
  PluginGeneratedExecutor,
  PluginGeneratedExecutorWithFile,
  PluginExecutorContext,
  PluginExecutorContextBase,
  TailorDBTypeForPlugin,
} from "@/types/plugin";

// Generation-time hook context types for plugin development
export type {
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  TailorDBNamespaceData,
  ResolverNamespaceData,
  GeneratorResult,
} from "@/types/plugin-generation";
