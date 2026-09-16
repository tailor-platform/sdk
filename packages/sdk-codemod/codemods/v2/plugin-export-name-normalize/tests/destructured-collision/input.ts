import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";

export const generators = definePlugins(myPlugin());

function debug(value: { generators: unknown }): unknown {
  const { generators } = value;
  return generators;
}
