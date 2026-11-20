import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { createShellHandler, type Accounts, type PlatformInfo, type Tab } from "./shell-handler";
import { createWorkspaceContext } from "./workspace-context";

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
  context: { basePath: string; token: string; getSelection: () => object },
) => Response | Promise<Response>;

function mounted(id: string, handler: Handler): Tab {
  return { id, title: id, state: "mounted", handler };
}

const PROFILES = [{ name: "test", workspaceId: "7390c4cc-914f-4791-89ee-f4a4ab4699fc" }];

function workspace(initialProfile?: string) {
  return createWorkspaceContext({
    ...(initialProfile === undefined ? {} : { initialProfile }),
    listProfiles: async () => PROFILES,
  });
}

const WORKSPACES = [{ id: "7390c4cc-914f-4791-89ee-f4a4ab4699fc", name: "dev" }];

function accounts(overrides: Partial<Accounts> = {}): Accounts {
  return {
    listUsers: async () => ["me@example.com"],
    listWorkspaces: async () => WORKSPACES,
    createProfile: async () => {},
    ...overrides,
  };
}

function shell(tabs: Tab[], ws = workspace(), acc = accounts(), platform?: PlatformInfo) {
  return createShellHandler({
    tabs,
    port: PORT,
    token: TOKEN,
    workspace: ws,
    accounts: acc,
    ...(platform === undefined ? {} : { platform }),
  });
}

function post(handler: (r: Request) => Promise<Response>, pathname: string, body: unknown) {
  return get(handler, pathname, {
    method: "POST",
    headers: { "x-tailor-studio-token": TOKEN, origin: `http://127.0.0.1:${PORT}` },
    body: JSON.stringify(body),
  });
}

function put(handler: (r: Request) => Promise<Response>, body: unknown, token: string | null) {
  return get(handler, "/api/context", {
    method: "PUT",
    headers: token === null ? {} : { "x-tailor-studio-token": token },
    body: JSON.stringify(body),
  });
}

describe("createShellHandler", () => {
  describe("/api/context", () => {
    test("lists the profiles with the current selection and hands out the token", async () => {
      const ws = workspace("test");
      await ws.restore();
      const res = await get(shell([], ws), "/api/context");
      expect(await res.json()).toEqual({
        token: TOKEN,
        profiles: PROFILES,
        selected: { profile: "test", workspaceId: PROFILES[0]!.workspaceId },
      });
    });

    test("reports the platform the environment changed, so the page can show it", async () => {
      const platform = { platformUrl: "https://platform.example", oauth2ClientId: "client" };
      const res = await get(shell([], workspace(), accounts(), platform), "/api/context");
      expect(((await res.json()) as { platform: unknown }).platform).toEqual(platform);
    });

    test("reports no platform when the environment leaves the default", async () => {
      const res = await get(shell([]), "/api/context");
      expect(await res.json()).not.toHaveProperty("platform");
    });

    test("PUT selects a profile and tabs read it on their next request", async () => {
      const seen: object[] = [];
      const handler = shell([
        mounted("erd", (_r, { getSelection }) => {
          seen.push(getSelection());
          return new Response("ok");
        }),
      ]);
      expect((await put(handler, { profile: "test" }, TOKEN)).status).toBe(200);
      await get(handler, "/plugins/erd/");
      expect(seen).toEqual([{ profile: "test", workspaceId: PROFILES[0]!.workspaceId }]);
    });

    test("PUT without the token is 403", async () => {
      expect((await put(shell([]), { profile: "test" }, null)).status).toBe(403);
    });

    test("PUT of an unknown profile is 400 with the reason", async () => {
      const res = await put(shell([]), { profile: "nope" }, TOKEN);
      expect([res.status, await res.json()]).toEqual([400, { error: 'Profile "nope" not found' }]);
    });
  });

  describe("creating a profile", () => {
    const input = { name: "test", user: "me@example.com", workspaceId: WORKSPACES[0]!.id };

    test("lists the logged-in users", async () => {
      const res = await get(shell([]), "/api/accounts");
      expect(await res.json()).toEqual({ users: ["me@example.com"] });
    });

    test("lists the workspaces of a user", async () => {
      const listWorkspaces = vi.fn(async () => WORKSPACES);
      const res = await get(
        shell([], workspace(), accounts({ listWorkspaces })),
        "/api/accounts/workspaces?user=me%40example.com",
      );
      expect([await res.json(), listWorkspaces.mock.calls[0]]).toEqual([
        WORKSPACES,
        ["me@example.com"],
      ]);
    });

    test("answers 400 when the workspaces cannot be listed", async () => {
      const failing = accounts({
        listWorkspaces: async () => {
          throw new Error("Token expired.");
        },
      });
      const res = await get(
        shell([], workspace(), failing),
        "/api/accounts/workspaces?user=me%40example.com",
      );
      expect([res.status, await res.json()]).toEqual([400, { error: "Token expired." }]);
    });

    test("creates the profile and selects it", async () => {
      const createProfile = vi.fn(async () => {});
      const res = await post(shell([], workspace(), accounts({ createProfile })), "/api/profiles", {
        ...input,
        permission: "read",
      });
      const body = (await res.json()) as { selected: object };
      expect([res.status, createProfile.mock.calls[0], body.selected]).toEqual([
        200,
        [{ ...input, permission: "read" }],
        { profile: "test", workspaceId: WORKSPACES[0]!.id },
      ]);
    });

    test("keeps the selection and answers 400 with the reason when creation fails", async () => {
      const ws = workspace();
      const failing = accounts({
        createProfile: async () => {
          throw new Error('Profile "test" already exists.');
        },
      });
      const res = await post(shell([], ws, failing), "/api/profiles", input);
      expect([res.status, await res.json(), ws.selection()]).toEqual([
        400,
        { error: 'Profile "test" already exists.' },
        {},
      ]);
    });

    test("answers 400 when the name, user or workspace is missing", async () => {
      const res = await post(shell([]), "/api/profiles", { name: "test" });
      expect(res.status).toBe(400);
    });

    test("answers 403 without the token", async () => {
      const res = await get(shell([]), "/api/profiles", { method: "POST", body: "{}" });
      expect(res.status).toBe(403);
    });
  });

  test("redirects /plugins/<id> to /plugins/<id>/ so relative asset URLs resolve", async () => {
    const res = await get(shell([mounted("erd", () => new Response("ok"))]), "/plugins/erd");
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe("/plugins/erd/");
  });

  test("passes the plugin the path below its prefix, the base path and the token", async () => {
    const plugin = vi.fn(
      (_r: Request, _c: { basePath: string; token: string; getSelection: () => object }) =>
        new Response("ok"),
    );
    await get(shell([mounted("erd", plugin)]), "/plugins/erd/assets/app.js?x=1");
    const [request, context] = plugin.mock.calls[0]!;
    expect(new URL(request.url).pathname + new URL(request.url).search).toBe("/assets/app.js?x=1");
    expect(context).toMatchObject({ basePath: "/plugins/erd/", token: TOKEN });
  });

  test.each(["//evil.example/x", "/\\evil.example/x", "//evil.example:1/x"])(
    "keeps the forwarded URL on the shell's origin when the path below the prefix is %j",
    async (rest) => {
      const plugin = vi.fn(
        (_r: Request, _c: { basePath: string; token: string; getSelection: () => object }) =>
          new Response("ok"),
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
    const handler = createShellHandler({
      tabs: [],
      port: PORT,
      token: TOKEN,
      workspace: workspace(),
      accounts: accounts(),
      clientDir,
    });
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
      workspace: workspace(),
      accounts: accounts(),
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
