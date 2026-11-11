import type {
  TailorDBNamespacePluginOutput as Output,
  TailorDBNamespaceLoadedContext as Context,
} from "@tailor-platform/sdk";

export function hook(context: Context): Output {
  return { tables: {}, resolvers: [], executors: [], ...{ namespace: context.namespace } };
}
