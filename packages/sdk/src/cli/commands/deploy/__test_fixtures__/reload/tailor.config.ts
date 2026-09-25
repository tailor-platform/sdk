// eslint-disable-next-line no-restricted-imports -- test fixture runs as standalone config, needs node:path
import * as path from "node:path";
import * as url from "node:url";
import { defineConfig } from "@tailor-platform/sdk";

const __dirname = path.dirname(url.fileURLToPath(import.meta.url));

const state = globalThis as typeof globalThis & {
  __tailorReloadConfigCount?: number;
};
state.__tailorReloadConfigCount = (state.__tailorReloadConfigCount ?? 0) + 1;

export default defineConfig({
  id: "22222222-2222-4222-8222-222222222222",
  name: "reload",
  workflow: {
    files: [path.join(__dirname, "workflows/*.ts")],
  },
});
