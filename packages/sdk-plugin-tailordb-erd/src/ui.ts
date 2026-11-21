import * as fs from "node:fs";
import * as os from "node:os";
import { fileURLToPath } from "node:url";
import * as path from "pathe";
import { runFreshErdExport } from "./serve";
import type { ErdBuildResult } from "./export";

const CLI_ENTRY = fileURLToPath(new URL("../bin/cli.mjs", import.meta.url));

interface UiHandlerContext {
  basePath: string;
}

type UiHandler = (request: Request, context: UiHandlerContext) => Promise<Response>;

interface ErdUiHandlerOptions {
  exportViewer: (outputDir: string) => Promise<ErdBuildResult[]>;
}

function exportViewerFromProject(outputDir: string): Promise<ErdBuildResult[]> {
  return runFreshErdExport({ cliEntry: CLI_ENTRY, outputDir });
}

/**
 * Create the handler that `tailor studio` mounts as the ERD tab.
 * @param options - Viewer exporter, replaceable for tests
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

    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-erd-"));
    try {
      const [primary] = await options.exportViewer(outputDir);
      if (!primary) {
        throw new Error("No TailorDB namespaces found in config.");
      }
      const html = fs.readFileSync(path.join(primary.distDir, "index.html"), "utf8");
      return new Response(html, { status: 200, headers });
    } finally {
      fs.rmSync(outputDir, { recursive: true, force: true });
    }
  };
}

export default createErdUiHandler({ exportViewer: exportViewerFromProject });
