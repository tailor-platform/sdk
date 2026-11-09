import type {
  NamespacePluginOutput as Output,
  PluginNamespaceProcessContext as Context,
} from "@tailor-platform/sdk";

export function hook(context: Context): Output {
  return { tables: {}, resolvers: [], executors: [], ...{ namespace: context.namespace } };
}
