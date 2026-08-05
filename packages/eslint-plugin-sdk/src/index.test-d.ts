import { defineConfig } from "eslint/config";
import plugin, { type TailorSdkPlugin, type TailorSdkRuleName } from "./index.js";

export const recommendedConfig = defineConfig(plugin.configs.recommended);
export const typedPlugin: TailorSdkPlugin = plugin;
export const ruleName: TailorSdkRuleName = "no-unconditional-permit";

// @ts-expect-error Rule names must be derived from the exported rules.
export const unknownRuleName: TailorSdkRuleName = "unknown-rule";
