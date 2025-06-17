import url from "node:url";
import path from "node:path";
import { Tailor, Workspace } from "@tailor-platform/tailor-sdk";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function defineWorkspace() {
  Tailor.init(process.argv[2] || path.join(__dirname, "..", ".tailor-sdk"));

  const workspace = new Workspace("tailor-sdk-dev");
  workspace.newApplication("my-app");
  workspace.defineTailorDBService({
    "my-db": { files: ["./src/tailordb/*.ts"] },
  });
  workspace.defineResolverService({
    "my-pipeline": { files: ["./src/resolvers/**/resolver.ts"] },
  });

  return workspace;
}

if (process.argv[1] === __filename) {
  const workspace = await defineWorkspace();
  await workspace.apply().catch(console.error);
}
