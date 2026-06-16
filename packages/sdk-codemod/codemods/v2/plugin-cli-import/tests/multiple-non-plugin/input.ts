import { defineConfig, defineAuth, seedPlugin } from "@tailor-platform/sdk/cli";

export default defineConfig({
  auth: defineAuth({}),
  plugins: [seedPlugin()],
});
