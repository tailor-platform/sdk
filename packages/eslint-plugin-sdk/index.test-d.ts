import { defineConfig } from "eslint/config";
import plugin from "./index.js";

export const recommendedConfig = defineConfig(plugin.configs.recommended);
