import type { Plugin } from "@tailor-platform/sdk";

interface PluginNamespaceProcessContext {
  namespace: string;
}

export function label(context: PluginNamespaceProcessContext, plugin: Plugin): string {
  return `${plugin.id}:${context.namespace}`;
}
