import { t as _t } from "#/configure/types/index";
import type * as helperTypes from "#/types/helpers";

type TailorOutput<T> = helperTypes.output<T>;

export type infer<T> = TailorOutput<T>;
export type output<T> = TailorOutput<T>;

/** TailorDB field type builders. */
// eslint-disable-next-line import-x/export
export const t = _t;
// eslint-disable-next-line @typescript-eslint/no-namespace, import-x/export
export namespace t {
  export type output<T> = TailorOutput<T>;
  export type infer<T> = TailorOutput<T>;
}

export { type TailorField } from "#/configure/types/type";
export type {
  DateString,
  DateTimeString,
  DecimalString,
  TimeString,
  TimeZoneOffsetString,
  UUIDString,
} from "#/configure/types/scalar.types";
export {
  type TailorPrincipal,
  type Attributes,
  type AttributeList,
  type Env,
} from "#/runtime/types";
export { type MachineUserNameRegistry, type MachineUserName } from "#/configure/types/machine-user";
export { type IdpNameRegistry, type IdpName } from "#/configure/types/idp-name";
export {
  type ConnectionNameRegistry,
  type ConnectionName,
} from "#/configure/types/connection-name";

export * from "#/configure/services/index";

export { defineConfig, definePlugins } from "#/configure/config/index";

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
} from "#/plugin/types";

// Generation-time hook context types for plugin development
export type {
  TailorDBReadyContext,
  ResolverReadyContext,
  ExecutorReadyContext,
  TailorDBNamespaceData,
  ResolverNamespaceData,
  GeneratorResult,
} from "#/plugin/types";
