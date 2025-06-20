import url from "node:url";
import path from "node:path";
import config from "../tailor.config.js"; // Adjust the path as necessary
import {
  Tailor,
  Workspace,
  type WorkspaceConfig,
} from "@tailor-platform/tailor-sdk";

const __filename = url.fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function defineWorkspace(config: WorkspaceConfig, distPath?: string) {
  Tailor.init(distPath ?? path.join(__dirname, "..", ".tailor-sdk"));

  const workspace = new Workspace(config.name);
  const app = workspace.newApplication(config.app.name);
  app.defineTailorDB(config.app.db);
  app.defineResolver(config.app.resolver);
  app.defineAuth(config.app.auth);

  return workspace;
}

if (process.argv[1] === __filename) {
  const workspace = defineWorkspace(config, process.argv[2]);
  await workspace.apply().catch(console.error);
}
