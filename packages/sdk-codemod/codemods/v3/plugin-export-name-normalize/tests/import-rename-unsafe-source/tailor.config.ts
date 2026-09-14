import { definePlugins } from "@tailor-platform/sdk";
import otherPlugin from "./plugins/other-plugin";

export const plugins = definePlugins(otherPlugin());
export const generator = definePlugins();
