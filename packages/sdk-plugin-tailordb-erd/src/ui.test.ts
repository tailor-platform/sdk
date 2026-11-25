import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { createErdUiHandler } from "./ui";

const context = { basePath: "/plugins/tailordb-erd" };
const root = "http://127.0.0.1:7777/";

function exportViewer(html: (outputDir: string) => string) {
  const outputDirs: string[] = [];
  return {
    outputDirs,
    run: async (outputDir: string) => {
      outputDirs.push(outputDir);
      const distDir = path.join(outputDir, "main", "dist");
      fs.mkdirSync(distDir, { recursive: true });
      fs.writeFileSync(path.join(distDir, "index.html"), html(outputDir));
      return [{ namespace: "main", distDir }];
    },
  };
}

describe("createErdUiHandler", () => {
  test("serves the exported viewer as HTML at the root", async () => {
    const handler = createErdUiHandler({
      exportViewer: exportViewer(() => "<html>viewer</html>").run,
    });

    const response = await handler(new Request(root), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<html>viewer</html>");
  });

  test("hands the request's abort signal to the export, so a load the browser abandoned can stop it", async () => {
    const received: (AbortSignal | undefined)[] = [];
    const handler = createErdUiHandler({
      exportViewer: async (outputDir, signal) => {
        received.push(signal);
        return exportViewer(() => "<html></html>").run(outputDir);
      },
    });
    const abandoned = new AbortController();

    await handler(new Request(root, { signal: abandoned.signal }), context);
    abandoned.abort();

    expect(received[0]?.aborted).toBe(true);
  });

  test("exports into a directory of its own per request, so overlapping loads cannot delete each other's output", async () => {
    const exporter = exportViewer((outputDir) => outputDir);
    const handler = createErdUiHandler({ exportViewer: exporter.run });

    await Promise.all([handler(new Request(root), context), handler(new Request(root), context)]);

    expect(new Set(exporter.outputDirs).size).toBe(2);
  });

  test("removes the export directory once the page is read, leaving the project's own .tailor/erd untouched", async () => {
    const exporter = exportViewer(() => "<html></html>");
    const handler = createErdUiHandler({ exportViewer: exporter.run });

    await handler(new Request(root), context);

    expect(fs.existsSync(exporter.outputDirs[0]!)).toBe(false);
  });

  test("removes the export directory when the export fails", async () => {
    const outputDirs: string[] = [];
    const handler = createErdUiHandler({
      exportViewer: async (outputDir) => {
        outputDirs.push(outputDir);
        throw new Error("export failed");
      },
    });

    await expect(handler(new Request(root), context)).rejects.toThrow("export failed");

    expect(fs.existsSync(outputDirs[0]!)).toBe(false);
  });

  test("fails with a clear message when the project has no TailorDB namespace", async () => {
    const handler = createErdUiHandler({ exportViewer: async () => [] });

    await expect(handler(new Request(root), context)).rejects.toThrow(
      "No TailorDB namespaces found",
    );
  });

  test("answers HEAD without exporting or sending a body", async () => {
    const exporter = exportViewer(() => "<html></html>");
    const handler = createErdUiHandler({ exportViewer: exporter.run });

    const response = await handler(new Request(root, { method: "HEAD" }), context);

    expect([response.status, await response.text(), exporter.outputDirs.length]).toEqual([
      200,
      "",
      0,
    ]);
  });

  test("rejects methods that change state", async () => {
    const handler = createErdUiHandler({ exportViewer: exportViewer(() => "").run });

    const response = await handler(new Request(root, { method: "POST" }), context);

    expect([response.status, response.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
  });

  test("returns 404 for any path other than the root", async () => {
    const handler = createErdUiHandler({ exportViewer: exportViewer(() => "").run });

    const response = await handler(new Request(`${root}other`), context);

    expect(response.status).toBe(404);
  });
});
