import url from "node:url";
import { defineWorkspace } from "./app";

const __filename = url.fileURLToPath(import.meta.url);

if (process.argv[1] === __filename) {
  const workspace = defineWorkspace();
  await workspace.ctlApply();
}
