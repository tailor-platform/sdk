import url from "node:url";
import path from "node:path";
import { Tailor } from "@tailor-platform/tailor-sdk";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function apply() {
  Tailor.init(process.argv[2] || path.join(__dirname, "..", "dist"));
  const workspace = Tailor.newWorkspace("my_workspace");

  workspace.defineTailorDBService({
    my_db: { files: ["./src/tailordb/*.ts"] },
  });

  workspace.defineResolverService({
    my_pipeline: { files: ["./src/resolvers/**/resolver.ts"] },
  });

  workspace.newApplication("my_app");
  await workspace.apply();
}

if (process.argv[1] === __filename) {
  await apply().catch(console.error);
}
