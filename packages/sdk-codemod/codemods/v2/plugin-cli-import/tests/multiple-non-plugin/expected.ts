import { defineConfig, defineAuth } from "@tailor-platform/sdk/cli";
import { seedPlugin } from "@tailor-platform/sdk/plugin/seed";

export default defineConfig({
  auth: defineAuth({}),
  plugins: [seedPlugin()],
});
