import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { loadDeployedApplications, runDeployedHooks } from "./deployed-hooks";
import type { OperatorClient } from "#/cli/shared/client";
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
}));
import { deployStaticWebsite } from "../staticwebsite/deploy";

function target(plugins: Plugin[], name = "app"): BuiltDeploymentTarget {
  return {
    config: { path: `/repo/${name}/tailor.config.ts`, aiGateways: [{ name: "ai" }] },
    application: {
      id: `${name}-id`,
      name,
      staticWebsiteServices: [{ name: `${name}-web` }],
      authService: { config: { name: "auth" } },
    },
    plugins,
  } as unknown as BuiltDeploymentTarget;
}
function sparseArray(): unknown[] {
  const list: unknown[] = [];
  list[1] = 1;
  return list;
}
function clientMock() {
  const methods = {
    getApplication: vi
      .fn()
      .mockResolvedValue({ application: { url: "https://app", domain: "app.example" } }),
    getStaticWebsite: vi.fn().mockImplementation(async ({ name }) => ({
      staticwebsite: { name, url: `https://${name}` },
    })),
    getAIGateway: vi.fn().mockResolvedValue({ aigateway: { name: "ai", url: "https://ai" } }),
    listAuthOAuth2Clients: vi.fn().mockResolvedValue({
      oauth2Clients: [{ name: "web", clientId: "public", clientSecret: "secret" }],
      nextPageToken: "",
    }),
  };
  return { methods, client: methods as unknown as OperatorClient };
}
function plugin(onDeployed: NonNullable<Plugin["onDeployed"]>, id = "hook"): Plugin {
  return { id, description: "test", pluginConfig: { setting: true }, onDeployed };
}

describe("deployed hooks", () => {
  test("does not fetch deployed information when there are no hooks", async () => {
    const { client, methods } = clientMock();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([])] }),
    ).resolves.toEqual([]);
    expect(methods.getApplication).not.toHaveBeenCalled();
    expect(methods.getStaticWebsite).not.toHaveBeenCalled();
    expect(methods.getAIGateway).not.toHaveBeenCalled();
    expect(methods.listAuthOAuth2Clients).not.toHaveBeenCalled();
  });
  test("passes deployed URLs and public OAuth client fields to the hook", async () => {
    const { client } = clientMock();
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
  test("lets the hook run shell commands on the deploying machine", async () => {
    const { client } = clientMock();
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
  test("collects every OAuth client page", async () => {
    const { client, methods } = clientMock();
    methods.listAuthOAuth2Clients.mockResolvedValueOnce({
      oauth2Clients: [],
      nextPageToken: "page2",
    });
    const hook = vi.fn();
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] });
    expect(methods.listAuthOAuth2Clients).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ pageToken: "page2" }),
    );
    expect(hook.mock.calls[0]?.[0].application.auth.oauth2Clients).toEqual([
      { name: "web", clientId: "public" },
    ]);
  });
  test("awaits hooks in target and registration order with all applications available", async () => {
    const { client } = clientMock();
    const seen: string[] = [];
    const hook = (id: string) =>
      plugin(async (ctx) => {
        await Promise.resolve();
        seen.push(`${ctx.application.name}:${id}`);
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
    const { client } = clientMock();
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
    const { client } = clientMock();
    const later = vi.fn();
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(() => {
              throw new Error("build failed");
            }),
            plugin(later, "later"),
          ]),
        ],
      }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringMatching(/applied successfully.*hook.*app.*build failed.*later/s),
    });
    expect(later).not.toHaveBeenCalled();
  });
  test("resolves public OAuth clients for an external Auth namespace", async () => {
    const { client, methods } = clientMock();
    const hook = vi.fn();
    const external = target([plugin(hook)]);
    Object.assign(external.application, { authService: undefined });
    Object.assign(external.config, { auth: { name: "shared-auth", external: true } });
    await runDeployedHooks({ client, workspaceId: "ws", targets: [external] });
    expect(methods.listAuthOAuth2Clients).toHaveBeenCalledWith(
      expect.objectContaining({ namespaceName: "shared-auth" }),
    );
    expect(hook.mock.calls[0]?.[0].application.auth).toEqual({
      namespace: "shared-auth",
      oauth2Clients: [{ name: "web", clientId: "public" }],
    });
  });
  test("reports applied resources when loading the hook context fails", async () => {
    const { client, methods } = clientMock();
    methods.getApplication.mockRejectedValue(new Error("network down"));
    const hook = vi.fn();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringMatching(/applied successfully.*network down.*Hooks not run: hook/s),
    });
    expect(hook).not.toHaveBeenCalled();
  });
  test("rejects hook outputs that cannot be serialized to JSON", async () => {
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
    const { client } = clientMock();
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
      message: expect.stringMatching(/Hooks not run: hook \(app: admin\)$/),
    });
  });
  test("names the application of each hook not run when loading the hook context fails", async () => {
    const { client, methods } = clientMock();
    methods.getApplication.mockRejectedValue(new Error("network down"));
    await expect(
      runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [target([plugin(vi.fn())], "web"), target([plugin(vi.fn())], "admin")],
      }),
    ).rejects.toMatchObject({
      message: expect.stringMatching(/Hooks not run: hook \(app: web\), hook \(app: admin\)$/),
    });
  });
  test("fails before running hooks when a static website has no URL assigned yet", async () => {
    const { client, methods } = clientMock();
    methods.getStaticWebsite.mockResolvedValue({ staticwebsite: { name: "app-web", url: "" } });
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
    const { client, methods } = clientMock();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(vi.fn())], "a"), target([], "b")],
    });
    expect(methods.listAuthOAuth2Clients).toHaveBeenCalledOnce();
  });
  test("reads each nested outputs value once so validation and storage agree", async () => {
    const { client } = clientMock();
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
    const { client } = clientMock();
    const outputs: Record<string, never | string> = { value: "validated" };
    const [stored] = await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([plugin(() => ({ outputs }))])],
    });
    outputs.value = "changed";
    expect(stored?.outputs).toEqual({ value: "validated" });
  });
  test("registers fetched OAuth client secrets for redaction", async () => {
    using registerSecret = vi.spyOn(logger, "registerSecret");
    const { client } = clientMock();
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(vi.fn())])] });
    expect(registerSecret).toHaveBeenCalledWith("secret");
  });
  test("fails when a configured AI Gateway is missing after deploy", async () => {
    const { client, methods } = clientMock();
    methods.getAIGateway.mockResolvedValue({ aigateway: undefined });
    const hook = vi.fn();
    await expect(
      runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] }),
    ).rejects.toMatchObject({
      code: "DEPLOYED_HOOK_FAILED",
      message: expect.stringContaining('AI Gateway "ai" not found after deploy'),
    });
    expect(hook).not.toHaveBeenCalled();
  });
  test("exposes only the static websites the config declares", async () => {
    const { client } = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([plugin(hook)])] });
    const { application } = hook.mock.calls[0]?.[0] as DeployedContext;
    expect(application.staticWebsites["toString"]).toBeUndefined();
  });
  test("rejects missing publish directories with an absolute path", async () => {
    const { client } = clientMock();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [
        target([
          plugin(async (ctx) => {
            await expect(
              ctx.application.staticWebsites["app-web"]?.publish("/missing/deployed-hook-build"),
            ).rejects.toThrow("/missing/deployed-hook-build");
          }),
        ]),
      ],
    });
    expect(deployStaticWebsite).not.toHaveBeenCalled();
  });
  test("reports stat failures other than a missing directory as they are", async () => {
    const { client } = clientMock();
    const dir = "/restricted/deployed-hook-build";
    statFailure.next = permissionDenied(dir);
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [
        target([
          plugin(async (ctx) => {
            await expect(ctx.application.staticWebsites["app-web"]?.publish(dir)).rejects.toThrow(
              "EACCES",
            );
          }),
        ]),
      ],
    });
    expect(deployStaticWebsite).not.toHaveBeenCalled();
  });
  test("lists another application's static websites with their URLs but no publish", async () => {
    const { client } = clientMock();
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
  test("keeps other applications' static websites out of the registering application", async () => {
    const { client } = clientMock();
    const hook = vi.fn();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [target([], "web-app"), target([plugin(hook)], "admin-app")],
    });
    const { application } = hook.mock.calls[0]?.[0] as DeployedContext;
    expect(Object.keys(application.staticWebsites)).toEqual(["admin-app-web"]);
  });
  test("publishes an existing directory to the static website", async () => {
    using _logger = silenceLogger();
    const dir = await mkdtemp(join(tmpdir(), "deployed-hook-"));
    try {
      const { client } = clientMock();
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(async (ctx: DeployedContext) => {
              expect(await ctx.application.staticWebsites["app-web"]?.publish(dir)).toEqual({
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
  test("rejects a publish path that is a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "deployed-hook-"));
    try {
      const file = join(dir, "file");
      await writeFile(file, "data");
      const { client } = clientMock();
      await runDeployedHooks({
        client,
        workspaceId: "ws",
        targets: [
          target([
            plugin(async (ctx) => {
              await expect(
                ctx.application.staticWebsites["app-web"]?.publish(file),
              ).rejects.toThrow(file);
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
  const { client, methods } = clientMock();
  const applications = await loadDeployedApplications({
    client,
    workspaceId: "ws",
    targets: [target([], "a"), target([], "b")],
  });
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
  expect(methods.listAuthOAuth2Clients).toHaveBeenCalledOnce();
});
