/**
 * Plugin utilities for creating reusable plugins.
 */

export {
  withPluginContext,
  type PluginDBSchema,
  type PluginExecutorFactory,
  type PluginFunctionArgs,
  type PluginRecord,
  type PluginRecordCreatedArgs,
  type PluginRecordDeletedArgs,
  type PluginRecordUpdatedArgs,
} from "./with-context";

export { getGeneratedType } from "./get-generated-type";
