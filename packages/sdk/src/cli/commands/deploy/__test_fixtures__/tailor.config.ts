// eslint-disable-next-line no-restricted-imports -- test fixture runs as standalone config, needs node:path
import * as path from "node:path";
import * as url from "node:url";
import { defineConfig, definePlugins } from "@tailor-platform/sdk";
import { enumConstantsPlugin } from "@tailor-platform/sdk/plugin/enum-constants";
import { kyselyTypePlugin } from "@tailor-platform/sdk/plugin/kysely-type";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const outDir = process.env.TAILOR_SDK_OUTPUT_DIR ?? path.join(__dirname, "dist");

export default defineConfig({
  // SDK-managed app id — do not edit, except when copying this config to a separate app.
  id: "47eb65f3-2de9-4279-883f-2db54815ae8a",
  name: "test-app",
  inlineSourcemap: false,
  env: {
    foo: 1,
    bar: "hello",
    baz: true,
  },
  db: {
    testdb: {
      files: [path.join(__dirname, "tailordb/*.ts")],
    },
  },
  resolver: {
    "test-resolver": { files: [path.join(__dirname, "resolvers/*.ts")] },
  },
  executor: { files: [path.join(__dirname, "executors/*.ts")] },
  workflow: {
    files: [path.join(__dirname, "workflows/**/*.ts")],
  },
});

export const plugins = definePlugins(
  kyselyTypePlugin({ distPath: path.join(outDir, "db.ts") }),
  enumConstantsPlugin({ distPath: path.join(outDir, "enums.ts") }),
);
