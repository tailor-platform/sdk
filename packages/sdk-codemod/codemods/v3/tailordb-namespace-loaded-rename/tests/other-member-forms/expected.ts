import type { Plugin } from "@tailor-platform/sdk";

type NamespaceHook = { onTailorDBNamespaceLoaded?: Plugin["onTailorDBNamespaceLoaded"] };

export class FieldPlugin {
  onTailorDBNamespaceLoaded = () => ({});
}

export const quotedMethod = {
  "onTailorDBNamespaceLoaded"() {
    return {};
  },
};

export function read(plugin: Plugin): NamespaceHook {
  const { onTailorDBNamespaceLoaded: hook } = plugin;
  console.log("onNamespaceLoaded");
  return { onTailorDBNamespaceLoaded: hook };
}
