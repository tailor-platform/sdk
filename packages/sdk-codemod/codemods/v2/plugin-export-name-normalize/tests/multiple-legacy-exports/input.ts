import { definePlugins } from "@tailor-platform/sdk";
import myPlugin from "./plugins/my-plugin";
import otherPlugin from "./plugins/other-plugin";

export const generator = definePlugins(myPlugin());
export const generators = definePlugins(otherPlugin());
