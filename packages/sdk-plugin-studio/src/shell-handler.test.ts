import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { createShellHandler, type Tab } from "./shell-handler";

const PORT = 7777;
const TOKEN = "t0ken";
const HOST = { host: `127.0.0.1:${PORT}` };

function get(handler: (r: Request) => Promise<Response>, pathname: string, init?: RequestInit) {
  return handler(
    new Request(`http://127.0.0.1:${PORT}${pathname}`, {
      ...init,
      headers: { ...HOST, ...(init?.headers as Record<string, string>) },
    }),
  );
}

type Handler = (
  request: Request,
  context: { basePath: string; token: string },
) => Response | Promise<Response>;

function mounted(id: string, handler: Handler): Tab {
  return { id, title: id, state: "mounted", handler };
}

function shell(tabs: Tab[]) {
  return createShellHandler({ tabs, port: PORT, token: TOKEN });
}

describe("createShellHandler", () => {
  test("redirects /plugins/<id> to /plugins/<id>/ so relative asset URLs resolve", async () => {
    const res = await get(shell([mounted("erd", () => new Response("ok"))]), "/plugins/erd");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/plugins/erd/");
  });

  test("passes the plugin the path below its prefix, the base path and the token", async () => {
    const plugin = vi.fn(
      (_r: Request, _c: { basePath: string; token: string }) => new Response("ok"),
    );
    await get(shell([mounted("erd", plugin)]), "/plugins/erd/assets/app.js?x=1");
    const [request, context] = plugin.mock.calls[0]!;
    expect(new URL(request.url).pathname + new URL(request.url).search).toBe("/assets/app.js?x=1");
    expect(context).toEqual({ basePath: "/plugins/erd/", token: TOKEN });
  });

  test.each(["//evil.example/x", "/\\evil.example/x", "//evil.example:1/x"])(
    "keeps the forwarded URL on the shell's origin when the path below the prefix is %j",
    async (rest) => {
      const plugin = vi.fn(
        (_r: Request, _c: { basePath: string; token: string }) => new Response("ok"),
      );
      await get(shell([mounted("erd", plugin)]), `/plugins/erd${rest}?q=1`);
      const forwarded = new URL(plugin.mock.calls[0]![0].url);
      expect(forwarded.origin).toBe(`http://127.0.0.1:${PORT}`);
      expect(forwarded.search).toBe("?q=1");
    },
  );

  test("answers 404 for an unknown plugin", async () => {
    expect((await get(shell([]), "/plugins/nope/")).status).toBe(404);
  });

  test("turns a throwing handler into a 500 for that request only", async () => {
    const handler = shell([
      mounted("bad", () => {
        throw new Error("boom");
      }),
      mounted("good", () => new Response("fine")),
    ]);
    expect((await get(handler, "/plugins/bad/")).status).toBe(500);
    expect(await (await get(handler, "/plugins/good/")).text()).toBe("fine");
  });

  test("applies the request guard before reaching a plugin", async () => {
    const plugin = vi.fn(() => new Response("ok"));
    const res = await get(shell([mounted("erd", plugin)]), "/plugins/erd/save", { method: "POST" });
    expect(res.status).toBe(403);
    expect(plugin).not.toHaveBeenCalled();
  });

  test("lists tabs with their state", async () => {
    const tabs: Tab[] = [
      mounted("erd", () => new Response("ok")),
      { id: "seed", title: "Seed", state: "not-installed", installCommand: "pnpm add -D x" },
      { id: "old", title: "Old", state: "no-ui-support" },
    ];
    const res = await get(shell(tabs), "/api/tabs");
    expect(await res.json()).toEqual([
      { id: "erd", title: "erd", state: "mounted" },
      { id: "seed", title: "Seed", state: "not-installed", installCommand: "pnpm add -D x" },
      { id: "old", title: "Old", state: "no-ui-support" },
    ]);
  });

  test("streams a plugin's text/event-stream response without buffering it", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: 1\n\n"));
      },
    });
    const res = await get(
      shell([
        mounted(
          "erd",
          () => new Response(stream, { headers: { "content-type": "text/event-stream" } }),
        ),
      ]),
      "/plugins/erd/events",
    );
    const reader = res.body!.getReader();
    expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: 1\n\n");
    await reader.cancel();
  });

  test("serves the built client for everything outside /api and /plugins", async () => {
    const clientDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailor-studio-client-"));
    fs.writeFileSync(path.join(clientDir, "index.html"), "<html>client</html>");
    const handler = createShellHandler({ tabs: [], port: PORT, token: TOKEN, clientDir });
    expect(await (await get(handler, "/erd")).text()).toBe("<html>client</html>");
    fs.rmSync(clientDir, { recursive: true });
  });

  test("reports a throwing plugin handler through onError", async () => {
    const onError = vi.fn();
    const failure = new Error("boom");
    const handler = createShellHandler({
      tabs: [
        mounted("bad", () => {
          throw failure;
        }),
      ],
      port: PORT,
      token: TOKEN,
      onError,
    });
    await get(handler, "/plugins/bad/");
    expect(onError).toHaveBeenCalledWith(failure, "bad");
  });

  describe("framing protection", () => {
    const framing = (res: Response) => ({
      frameOptions: res.headers.get("x-frame-options"),
      ancestors: res.headers.get("content-security-policy")?.includes("frame-ancestors 'self'"),
    });
    const protectedHeaders = { frameOptions: "SAMEORIGIN", ancestors: true };

    test("is set on a plugin response", async () => {
      const res = await get(shell([mounted("erd", () => new Response("ok"))]), "/plugins/erd/");
      expect(framing(res)).toEqual(protectedHeaders);
    });

    test("is set on the shell's own responses, including rejections", async () => {
      expect(framing(await get(shell([]), "/api/tabs"))).toEqual(protectedHeaders);
      expect(framing(await get(shell([]), "/nope/x.js"))).toEqual(protectedHeaders);
      const rejected = await get(shell([]), "/api/tabs", { headers: { host: "evil.example" } });
      expect(framing(rejected)).toEqual(protectedHeaders);
    });

    test("keeps the plugin's own Content-Security-Policy directives", async () => {
      const res = await get(
        shell([
          mounted(
            "erd",
            () =>
              new Response("ok", { headers: { "content-security-policy": "default-src 'none'" } }),
          ),
        ]),
        "/plugins/erd/",
      );
      expect(res.headers.get("content-security-policy")).toBe(
        "default-src 'none'; frame-ancestors 'self'",
      );
    });
  });
});
