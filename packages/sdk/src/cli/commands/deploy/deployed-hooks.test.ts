import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as path from "pathe";
import { describe, expect, test, vi } from "vitest";
import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { loadDeployedTargets, runDeployedHooks } from "./deployed-hooks";
import type { DeployedContext, Plugin } from "#/plugin/types";
import type { BuiltDeploymentTarget } from "./deployment-target";

const statFailure = vi.hoisted(() => ({ next: undefined as Error | undefined }));
vi.mock(import("node:fs/promises"), async (original) => {
  const actual = await original();
  const stat = (async (...args: Parameters<typeof actual.stat>) => {
    const failure = statFailure.next;
    statFailure.next = undefined;
    if (failure) throw failure;
    return actual.stat(...args);
  }) as typeof actual.stat;
  return { ...actual, stat, default: { ...actual, stat } };
});
function permissionDenied(path: string): Error {
  return Object.assign(new Error(`EACCES: permission denied, stat '${path}'`), { code: "EACCES" });
}
vi.mock("../staticwebsite/deploy", () => ({
  deployStaticWebsite: vi.fn().mockResolvedValue({ url: "https://published", skippedFiles: [] }),
  staticWebsiteDeployTimeoutError: vi.fn(),
}));
import { deployStaticWebsite } from "../staticwebsite/deploy";

function target(plugins: Plugin[], name = "app"): BuiltDeploymentTarget {
  const configPath = `/repo/${name}/tailor.config.ts`;
  const application = {
    staticWebsiteServices: [{ name: `${name}-web` }],
    aiGatewayServices: [{ name: "ai" }],
    authServices: [{ config: { name: "auth" } }],
  };
  return {
    source: {
      kind: "config",
      config: { path: configPath, name },
      application: { ...application, id: `${name}-id`, name },
    },
    config: { path: configPath },
    application,
    owner: { kind: "application", name, id: `${name}-id` },
    applications: [{ name, subgraphs: [{}], authNamespace: "auth", settings: {} }],
    plugins,
  } as unknown as BuiltDeploymentTarget;
}
function workspaceTarget(plugins: Plugin[], apps: readonly string[]): BuiltDeploymentTarget {
  const configPath = "/repo/tailor.config.ts";
  const application = {
    staticWebsiteServices: [{ name: "front" }, { name: "console" }],
    aiGatewayServices: [],
    authServices: [{ config: { name: "auth" } }],
  };
  return {
    source: { kind: "workspace", workspace: { path: configPath } },
    config: { path: configPath },
    application,
    owner: { kind: "workspace" },
    applications: apps.map((name) => ({
      name,
      subgraphs: [{}],
      authNamespace: "auth",
      settings: {},
    })),
    plugins,
  } as unknown as BuiltDeploymentTarget;
}
function sparseArray(): unknown[] {
  const list: unknown[] = [];
  list[1] = 1;
  return list;
}
function clientMock() {
  return mockOperatorClient({
    getApplication: { application: { url: "https://app", domain: "app.example" } },
    getStaticWebsite: async (request) => ({
      staticwebsite: { name: request.name, url: `https://${request.name}` },
    }),
    getAIGateway: { aigateway: { name: "ai", url: "https://ai" } },
    listAuthOAuth2Clients: {
      oauth2Clients: [{ name: "web", clientId: "public", description: "Web client" }],
      nextPageToken: "",
    },
  });
}
function plugin(onDeployed: NonNullable<Plugin["onDeployed"]>, id = "hook"): Plugin {
  return { id, description: "test", pluginConfig: { setting: true }, onDeployed };
}

describe("deployed hooks", () => {
  test("does not fetch deployed information when there are no hooks", async () => {
    const client = clientMock();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([])] }),
    ).resolves.toEqual([]);
    expect(client.getApplication).not.toHaveBeenCalled();
    expect(client.getStaticWebsite).not.toHaveBeenCalled();
    expect(client.getAIGateway).not.toHaveBeenCalled();
    expect(client.listAuthOAuth2Clients).not.toHaveBeenCalled();
  });
  test("passes deployed URLs and public OAuth client fields to the hook", async () => {
    const client = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] });
    expect(hook).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        workspaceId: "ws",
        configPath: "/repo/app/tailor.config.ts",
        pluginConfig: { setting: true },
        application: {
          id: "app-id",
          name: "app",
          configPath: "/repo/app/tailor.config.ts",
          url: "https://app",
          domain: "app.example",
          aiGateways: [{ name: "ai", url: "https://ai" }],
          auth: { namespace: "auth", oauth2Clients: [{ name: "web", clientId: "public" }] },
          staticWebsites: {
            "app-web": { name: "app-web", url: "https://app-web", publish: expect.any(Function) },
          },
        },
      }),
    );
  });
  test("passes the profile the deploy ran with to the hook", async () => {
    const client = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(hook)])],
      profile: "ci",
    });
    expect(hook).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ profile: "ci" }));
  });

  test("leaves the profile out of the hook context when the deploy was run without one", async () => {
    const client = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] });
    expect(hook).toHaveBeenCalledExactlyOnceWith(
      expect.not.objectContaining({ profile: expect.anything() }),
    );
  });

  test("lets the hook run shell commands on the deploying machine", async () => {
    const client = clientMock();
    const [stored] = await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [
        target([
          plugin(async (ctx) => {
            const { stdout } = await ctx.exec(`node -e "process.stdout.write('ran')"`, {
              workingDir: tmpdir(),
              output: "capture",
            });
            return { outputs: { stdout } };
          }),
        ]),
      ],
    });
    expect(stored?.outputs).toEqual({ stdout: "ran" });
  });
  test("gives the hook Node's fs and path to work with files on the deploying machine", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deployed-hooks-node-"));
    try {
      const client = clientMock();
      const [stored] = await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(async (ctx) => {
              const file = ctx.node.path.join(dir, "config.json");
              await ctx.node.fs.writeFile(file, '{"ok":true}');
              return { outputs: { content: await ctx.node.fs.readFile(file, "utf8") } };
            }),
          ]),
        ],
      });
      expect(stored?.outputs).toEqual({ content: '{"ok":true}' });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("collects every OAuth client page", async () => {
    const client = clientMock();
    client.listAuthOAuth2Clients.mockResolvedValueOnce({
      oauth2Clients: [],
      nextPageToken: "page2",
    });
    const hook = vi.fn();
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] });
    expect(client.listAuthOAuth2Clients).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageToken: "page2" }),
    );
    expect(hook.mock.calls[0]?.[0].application.auth.oauth2Clients).toEqual([
      { name: "web", clientId: "public" },
    ]);
  });
  test("awaits hooks in target and registration order with all applications available", async () => {
    const client = clientMock();
    const seen: string[] = [];
    const hook = (id: string) =>
      plugin(async (ctx) => {
        await Promise.resolve();
        seen.push(`${path.basename(path.dirname(ctx.configPath))}:${id}`);
        expect(ctx.applications).toHaveLength(2);
        expect(ctx.applications.map((app) => Object.keys(app.staticWebsites))).toEqual([
          ["a-web"],
          ["b-web"],
        ]);
      }, id);
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([hook("1"), hook("2")], "a"), target([hook("3")], "b")],
    });
    expect(seen).toEqual(["a:1", "a:2", "b:3"]);
  });
  test("returns only hooks that supplied outputs", async () => {
    const client = clientMock();
    const outputs = { result: "done" };
    expect(
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(() => {}, "silent"), plugin(() => ({ outputs }))])],
      }),
    ).toEqual([{ application: "app", pluginId: "hook", outputs }]);
  });
  test("stops after a failed hook and identifies unapplied hooks in the error", async () => {
    const client = clientMock();
    const later = vi.fn();
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(() => {
              throw new Error("Build failed.");
            }),
            plugin(later, "later"),
          ]),
        ],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message:
        'Platform resources were applied successfully, but the onDeployed hook of plugin "hook" failed for app "app": Build failed.',
      details: "Hooks not run: later (app: app)",
    });
    expect(later).not.toHaveBeenCalled();
  });
  test("resolves public OAuth clients for an external Auth namespace", async () => {
    const client = clientMock();
    const hook = vi.fn();
    const external = target([plugin(hook)]);
    Object.assign(external.application, { authServices: [] });
    Object.assign(external, {
      applications: [{ name: "app", subgraphs: [{}], authNamespace: "shared-auth", settings: {} }],
    });
    await runDeployedHooks({ client, workspaceId: "ws", targets: [external] });
    expect(client.listAuthOAuth2Clients).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "shared-auth" }),
    );
    expect(hook.mock.calls[0]?.[0].application.auth).toEqual({
      namespace: "shared-auth",
      oauth2Clients: [{ name: "web", clientId: "public" }],
    });
  });
  test("reports applied resources when loading the hook context fails", async () => {
    const client = clientMock();
    client.getApplication.mockRejectedValue(new Error("network down"));
    const hook = vi.fn();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringMatching(/applied successfully.*network down$/s),
      details: "Hooks not run: hook (app: app)",
    });
    expect(hook).not.toHaveBeenCalled();
  });
  test("rejects hook outputs that cannot be serialized to JSON", async () => {
    const client = clientMock();
    const outputs = { size: 1n } as unknown as Record<string, never>;
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(() => ({ outputs }))])],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringMatching(/hook.*outputs.*JSON/s),
    });
  });
  test.each([
    ["undefined", { nested: { value: undefined } }, "outputs.nested.value"],
    ["a function", { list: [() => {}] }, "outputs.list[0]"],
    ["a non-finite number", { ratio: Number.NaN }, "outputs.ratio"],
    ["a Date", { at: new Date(0) }, "outputs.at"],
    ["an array hole", { list: sparseArray() }, "outputs.list[0]"],
    [
      "a class instance",
      {
        item: new (class Point {
          x = 1;
        })(),
      },
      "outputs.item",
    ],
  ])("rejects hook outputs containing %s and names its path", async (_, outputs, where) => {
    const client = clientMock();
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([plugin(() => ({ outputs: outputs as unknown as Record<string, never> }))]),
        ],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining(where),
    });
  });
  test("validates and stores the outputs value it read once", async () => {
    const client = clientMock();
    let reads = 0;
    const result = {
      get outputs() {
        reads += 1;
        return reads === 1 ? { value: 1 } : { value: () => {} };
      },
    } as unknown as { outputs: Record<string, never> };
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(() => result)])] }),
    ).resolves.toEqual([{ application: "app", pluginId: "hook", outputs: { value: 1 } }]);
    expect(reads).toBe(1);
  });
  test("rejects cyclic hook outputs instead of recursing forever", async () => {
    const client = clientMock();
    const outputs: Record<string, unknown> = {};
    outputs.self = outputs;
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(() => ({ outputs: outputs as Record<string, never> }))])],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining("outputs.self"),
    });
  });
  test("keeps a __proto__ key in hook outputs as data", async () => {
    const client = clientMock();
    const outputs = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, never>;
    const [stored] = await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(() => ({ outputs }))])],
    });
    expect(Object.getPrototypeOf(stored?.outputs)).toBe(Object.prototype);
    expect(Object.hasOwn(stored?.outputs ?? {}, "__proto__")).toBe(true);
  });
  test("accepts nested JSON values in hook outputs", async () => {
    const client = clientMock();
    const outputs = { list: [1, "a", true, null, { deep: [] }], empty: {} };
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(() => ({ outputs }))])],
      }),
    ).resolves.toEqual([{ application: "app", pluginId: "hook", outputs }]);
  });
  test.each([
    ["an array", [1]],
    ["a string", "url"],
    ["null", null],
  ])("rejects hook outputs whose root is %s", async (_, outputs) => {
    const client = clientMock();
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([plugin(() => ({ outputs: outputs as unknown as Record<string, never> }))]),
        ],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining("outputs must be a plain object"),
    });
  });
  test("rejects a Date nested in an interface-typed output at deploy time", async () => {
    interface Event {
      when: Date;
    }
    const event: Event = { when: new Date(0) };
    const client = clientMock();
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(() => ({ outputs: { event } }))])],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining("outputs.event.when"),
    });
  });
  test("names the application of each hook not run after a hook fails", async () => {
    const client = clientMock();
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target(
            [
              plugin(() => {
                throw new Error("build failed");
              }),
            ],
            "web",
          ),
          target([plugin(vi.fn())], "admin"),
        ],
      }),
    ).rejects.toMatchObject({
      details: "Hooks not run: hook (app: admin)",
    });
  });
  test("names the application of each hook not run when loading the hook context fails", async () => {
    const client = clientMock();
    client.getApplication.mockRejectedValue(new Error("network down"));
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(vi.fn())], "web"), target([plugin(vi.fn())], "admin")],
      }),
    ).rejects.toMatchObject({
      details: "Hooks not run: hook (app: web), hook (app: admin)",
    });
  });
  test("fails before running hooks when a static website has no URL assigned yet", async () => {
    const client = clientMock();
    client.getStaticWebsite.mockResolvedValue({ staticwebsite: { name: "app-web", url: "" } });
    const hook = vi.fn();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining('Static website "app-web" has no URL assigned yet'),
    });
    expect(hook).not.toHaveBeenCalled();
  });
  test("lists the OAuth clients of an Auth namespace shared by several apps once", async () => {
    const client = clientMock();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(vi.fn())], "a"), target([], "b")],
    });
    expect(client.listAuthOAuth2Clients).toHaveBeenCalledOnce();
  });
  test("reads each nested outputs value once so validation and storage agree", async () => {
    const client = clientMock();
    let reads = 0;
    const outputs = {
      nested: {
        get value() {
          reads += 1;
          return reads === 1 ? "ok" : undefined;
        },
      },
    } as unknown as Record<string, never>;
    const [stored] = await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(() => ({ outputs }))])],
    });
    expect(stored?.outputs).toEqual({ nested: { value: "ok" } });
    expect(reads).toBe(1);
  });
  test("keeps the validated outputs even if the hook mutates them afterwards", async () => {
    const client = clientMock();
    const outputs: Record<string, never | string> = { value: "validated" };
    const [stored] = await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(() => ({ outputs }))])],
    });
    outputs.value = "changed";
    expect(stored?.outputs).toEqual({ value: "validated" });
  });
  test("fails when a configured AI Gateway is missing after deploy", async () => {
    const client = clientMock();
    client.getAIGateway.mockResolvedValue({ aigateway: undefined });
    const hook = vi.fn();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining('AI Gateway "ai" not found after deploy'),
    });
    expect(hook).not.toHaveBeenCalled();
  });
  test("rejects missing publish directories with an absolute path", async () => {
    const client = clientMock();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [
        target([
          plugin(async (ctx) => {
            await expect(
              ctx.staticWebsites["app-web"]?.publish("/missing/deployed-hook-build"),
            ).rejects.toThrow("/missing/deployed-hook-build");
          }),
        ]),
      ],
    });
    expect(deployStaticWebsite).not.toHaveBeenCalled();
  });
  test("reports stat failures other than a missing directory as they are", async () => {
    const client = clientMock();
    const dir = "/restricted/deployed-hook-build";
    statFailure.next = permissionDenied(dir);
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [
        target([
          plugin(async (ctx) => {
            await expect(ctx.staticWebsites["app-web"]?.publish(dir)).rejects.toThrow("EACCES");
          }),
        ]),
      ],
    });
    expect(deployStaticWebsite).not.toHaveBeenCalled();
  });
  test("lists another application's static websites with their URLs but no publish", async () => {
    const client = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([], "web-app"), target([plugin(hook)], "admin-app")],
    });
    const { applications } = hook.mock.calls[0]?.[0] as DeployedContext;
    expect(applications.find((app) => app.name === "web-app")?.staticWebsites).toEqual({
      "web-app-web": { name: "web-app-web", url: "https://web-app-web" },
    });
  });
  test("publishes an existing directory to the static website", async () => {
    using _logger = silenceLogger();
    const dir = await mkdtemp(join(tmpdir(), "deployed-hook-"));
    try {
      const client = clientMock();
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(async (ctx: DeployedContext) => {
              expect(await ctx.staticWebsites["app-web"]?.publish(dir)).toEqual({
                url: "https://published",
                skippedFiles: [],
              });
            }),
          ]),
        ],
      });
      expect(deployStaticWebsite).toHaveBeenCalledWith(
        client,
        "ws",
        "app-web",
        dir,
        expect.any(Boolean),
      );
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
  test("gives the hook every static website of its config with publish", async () => {
    const client = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([], "web-app"), target([plugin(hook)], "admin-app")],
    });
    const { staticWebsites } = hook.mock.calls[0]?.[0] as DeployedContext;
    expect(staticWebsites).toEqual({
      "admin-app-web": {
        name: "admin-app-web",
        url: "https://admin-app-web",
        publish: expect.any(Function),
      },
    });
    expect(staticWebsites["toString"]).toBeUndefined();
  });

  describe("for a workspace config", () => {
    test("gives the hook its static websites and every application", async () => {
      const client = clientMock();
      const hook = vi.fn();
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [workspaceTarget([plugin(hook)], ["shop", "admin"])],
      });
      const context = hook.mock.calls[0]?.[0] as DeployedContext;
      expect(Object.keys(context.staticWebsites)).toEqual(["front", "console"]);
      expect(context.staticWebsites["front"]?.publish).toEqual(expect.any(Function));
      expect(context.applications.map(({ name }) => name)).toEqual(["shop", "admin"]);
      expect(context.applications[0]).not.toHaveProperty("id");
    });

    test("fails the hook that reads application when the config deploys several", async () => {
      const client = clientMock();
      const later = vi.fn();
      const error = await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          workspaceTarget(
            [
              // oxlint-disable-next-line typescript/no-deprecated -- Reading the deprecated field is what this test covers.
              plugin((ctx) => void ctx.application.name),
              plugin(later, "later"),
            ],
            ["shop", "admin"],
          ),
        ],
      }).catch((thrown: unknown) => thrown);
      expect(error).toMatchObject({
        code: "DEPLOYED_HOOK_FAILED",
        message: expect.stringContaining('hook of plugin "hook" failed for the workspace config: '),
        details: "Hooks not run: later (workspace config)",
        cause: {
          code: "PLUGIN_CONTEXT_FIELD_AMBIGUOUS",
          context: {
            field: "application",
            replacement: ["applications", "staticWebsites"],
            candidates: ["shop", "admin"],
          },
        },
      });
      expect(later).not.toHaveBeenCalled();
    });

    test("gives the hook its only application, with publishable static websites", async () => {
      const client = clientMock();
      const hook = vi.fn();
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [workspaceTarget([plugin(hook)], ["shop"])],
      });
      // oxlint-disable-next-line typescript/no-deprecated -- The deprecated field keeps working for one application.
      const { application } = hook.mock.calls[0]?.[0] as DeployedContext;
      expect(application.name).toBe("shop");
      expect(application.staticWebsites["front"]?.publish).toEqual(expect.any(Function));
    });

    test("reports hook outputs without an application", async () => {
      const client = clientMock();
      const outputs = { published: true };
      expect(
        await runDeployedHooks({
          client,
          workspaceId: "ws",
          targets: [workspaceTarget([plugin(() => ({ outputs }))], ["shop", "admin"])],
        }),
      ).toEqual([{ pluginId: "hook", outputs }]);
    });
  });

  test("rejects a publish path that is a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deployed-hook-"));
    try {
      const file = join(dir, "file");
      await writeFile(file, "data");
      const client = clientMock();
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(async (ctx) => {
              await expect(ctx.staticWebsites["app-web"]?.publish(file)).rejects.toThrow(file);
            }),
          ]),
        ],
      });
      expect(deployStaticWebsite).not.toHaveBeenCalled();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

test("loads serializable deployed information for every application without hooks", async () => {
  const client = clientMock();
  const deployed = await loadDeployedTargets({
    client,
    workspaceId: "ws",
    targets: [target([], "a"), target([], "b")],
  });
  const applications = deployed.flatMap((entry) => entry.applications);
  expect(JSON.parse(JSON.stringify(applications))).toEqual([
    {
      id: "a-id",
      name: "a",
      configPath: "/repo/a/tailor.config.ts",
      url: "https://app",
      domain: "app.example",
      aiGateways: [{ name: "ai", url: "https://ai" }],
      staticWebsites: { "a-web": { name: "a-web", url: "https://a-web" } },
      auth: { namespace: "auth", oauth2Clients: [{ name: "web", clientId: "public" }] },
    },
    {
      id: "b-id",
      name: "b",
      configPath: "/repo/b/tailor.config.ts",
      url: "https://app",
      domain: "app.example",
      aiGateways: [{ name: "ai", url: "https://ai" }],
      staticWebsites: { "b-web": { name: "b-web", url: "https://b-web" } },
      auth: { namespace: "auth", oauth2Clients: [{ name: "web", clientId: "public" }] },
    },
  ]);
  expect(client.listAuthOAuth2Clients).toHaveBeenCalledOnce();
});
