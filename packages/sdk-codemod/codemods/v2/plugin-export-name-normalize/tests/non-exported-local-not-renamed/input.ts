import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

function buildLocalPlugins() {
  const generators = definePlugins(myPlugin());
  return generators;
}

export default buildLocalPlugins;
