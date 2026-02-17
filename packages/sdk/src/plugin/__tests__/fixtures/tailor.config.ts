// oxlint-disable no-restricted-imports -- Test fixture requires configure and builtin imports
import { defineConfig, definePlugins } from "@/configure/config";
import changesetPlugin from "@/plugin/builtin/changeset";

export default defineConfig({
  name: "test-app",
  db: {
    testdb: {
      files: ["./types/*.ts"],
    },
  },
});

export const plugins = definePlugins(changesetPlugin);
