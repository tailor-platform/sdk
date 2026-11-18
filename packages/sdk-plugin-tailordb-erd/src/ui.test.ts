import { describe, expect, test } from "vitest";
import { createErdUiHandler } from "./ui";

const context = { basePath: "/plugins/tailordb-erd", token: "t" };
const root = "http://127.0.0.1:7777/";

describe("createErdUiHandler", () => {
  test("serves the built viewer as HTML at the root", async () => {
    const handler = createErdUiHandler({ buildViewerHtml: async () => "<html>viewer</html>" });

    const response = await handler(new Request(root), context);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(await response.text()).toBe("<html>viewer</html>");
  });

  test("rebuilds on every request so a reload shows edited definitions", async () => {
    const builds = ["first", "second"];
    const handler = createErdUiHandler({ buildViewerHtml: async () => builds.shift()! });

    const first = await handler(new Request(root), context);
    const second = await handler(new Request(root), context);

    expect([await first.text(), await second.text()]).toEqual(["first", "second"]);
  });

  test("answers HEAD without building or sending a body", async () => {
    let builds = 0;
    const handler = createErdUiHandler({
      buildViewerHtml: async () => {
        builds += 1;
        return "<html></html>";
      },
    });

    const response = await handler(new Request(root, { method: "HEAD" }), context);

    expect([response.status, await response.text(), builds]).toEqual([200, "", 0]);
  });

  test("rejects methods that change state", async () => {
    const handler = createErdUiHandler({ buildViewerHtml: async () => "" });

    const response = await handler(new Request(root, { method: "POST" }), context);

    expect([response.status, response.headers.get("allow")]).toEqual([405, "GET, HEAD"]);
  });

  test("returns 404 for any path other than the root", async () => {
    const handler = createErdUiHandler({ buildViewerHtml: async () => "" });

    const response = await handler(new Request(`${root}other`), context);

    expect(response.status).toBe(404);
  });
});
