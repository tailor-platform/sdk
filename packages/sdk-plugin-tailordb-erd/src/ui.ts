import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { runFreshErdExport } from "./serve";

const OUTPUT_DIR = ".tailor/erd";
const CLI_ENTRY = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

interface UiHandlerContext {
  basePath: string;
  token: string;
}

type UiHandler = (request: Request, context: UiHandlerContext) => Promise<Response>;

interface ErdUiHandlerOptions {
  buildViewerHtml: () => Promise<string>;
}

async function buildViewerHtmlFromProject(): Promise<string> {
  const [primary] = await runFreshErdExport({
    cliEntry: CLI_ENTRY,
    outputDir: path.resolve(process.cwd(), OUTPUT_DIR),
  });
  if (!primary) {
    throw new Error("No TailorDB namespaces found in config.");
  }
  return fs.readFileSync(path.join(primary.distDir, "index.html"), "utf8");
}

/**
 * Create the handler that `tailor webui` mounts as the ERD tab.
 * @param options - Viewer builder, replaceable for tests
 * @returns A Web-standard request handler
 */
export function createErdUiHandler(options: ErdUiHandlerOptions): UiHandler {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", { status: 405, headers: { allow: "GET, HEAD" } });
    }
    if (new URL(request.url).pathname !== "/") {
      return new Response("Not Found", { status: 404 });
    }

    const headers = { "content-type": "text/html; charset=utf-8", "cache-control": "no-cache" };
    if (request.method === "HEAD") {
      return new Response(null, { status: 200, headers });
    }
    return new Response(await options.buildViewerHtml(), { status: 200, headers });
  };
}

export default createErdUiHandler({ buildViewerHtml: buildViewerHtmlFromProject });
