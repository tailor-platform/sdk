import { definePlugins } from "@tailor-platform/sdk";
import { softDeletePlugin } from "../plugins/soft-delete";

export const plugins = definePlugins(
  // Custom plugin with pluginConfig - global settings for all types using this plugin
  softDeletePlugin({
    archiveTablePrefix: "Deleted_", // Custom prefix for archive tables
    defaultRetentionDays: 90, // Default retention period in days
  }),
);
