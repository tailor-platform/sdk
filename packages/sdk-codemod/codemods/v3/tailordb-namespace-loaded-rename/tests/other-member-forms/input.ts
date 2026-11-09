import type { Plugin } from "@tailor-platform/sdk";

type NamespaceHook = { onNamespaceLoaded?: Plugin["onNamespaceLoaded"] };

export class FieldPlugin {
  onNamespaceLoaded = () => ({});
}

export const quotedMethod = {
  "onNamespaceLoaded"() {
    return {};
  },
};

export function read(plugin: Plugin): NamespaceHook {
  const { onNamespaceLoaded: hook } = plugin;
  console.log("onNamespaceLoaded");
  return { onNamespaceLoaded: hook };
}
