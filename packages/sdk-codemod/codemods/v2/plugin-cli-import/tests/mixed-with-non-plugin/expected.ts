import { defineConfig } from "@tailor-platform/sdk/cli";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

export default defineConfig({
  plugins: [kyselyTypePlugin()],
});
