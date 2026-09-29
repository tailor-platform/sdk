import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { runDeployedHooks } from "./deployed-hooks";
import type { OperatorClient } from "#/cli/shared/client";
import type { DeployedContext, Plugin } from "#/plugin/types";
import type { BuiltDeploymentTarget } from "./deployment-target";

vi.mock("../staticwebsite/deploy", () => ({
  deployStaticWebsite: vi.fn().mockResolvedValue({ url: "https://published", skippedFiles: [] }),
}));
import { deployStaticWebsite } from "../staticwebsite/deploy";

function target(plugins: Plugin[], name = "app"): BuiltDeploymentTarget {
  return {
    config: { path: `/repo/${name}/tailor.config.ts`, aiGateways: [{ name: "ai" }] },
    application: {
      name,
      staticWebsiteServices: [{ name: `${name}-web` }],
      authService: { config: { name: "auth" } },
    },
    plugins,
  } as unknown as BuiltDeploymentTarget;
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
          name: "app",
          configPath: "/repo/app/tailor.config.ts",
          url: "https://app",
          domain: "app.example",
          staticWebsites: [{ name: "app-web", url: "https://app-web" }],
          aiGateways: [{ name: "ai", url: "https://ai" }],
          auth: { namespace: "auth", oauth2Clients: [{ name: "web", clientId: "public" }] },
        },
        staticWebsites: { "app-web": { name: "app-web", url: "https://app-web" } },
      }),
    );
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
        expect(Object.keys(ctx.staticWebsites)).toEqual(["a-web", "b-web"]);
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
  test("rejects uploads to sites outside this deploy", async () => {
    const { client } = clientMock();
    const hook = plugin(async (ctx) => {
      await expect(ctx.uploadStaticWebsite({ name: "toString", dir: "/tmp" })).rejects.toThrow(
        "toString",
      );
    });
    await runDeployedHooks({ client, workspaceId: "ws", targets: [target([hook])] });
    expect(deployStaticWebsite).not.toHaveBeenCalled();
  });
  test("rejects missing upload directories with an absolute path", async () => {
    const { client } = clientMock();
    await runDeployedHooks({
      client,
      workspaceId: "ws",
      targets: [
        target([
          plugin(async (ctx) => {
            await expect(
              ctx.uploadStaticWebsite({ name: "app-web", dir: "/missing/deployed-hook-build" }),
            ).rejects.toThrow("/missing/deployed-hook-build");
          }),
        ]),
      ],
    });
    expect(deployStaticWebsite).not.toHaveBeenCalled();
  });
  test("uploads an existing directory through the injected capability", async () => {
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
              expect(await ctx.uploadStaticWebsite({ name: "app-web", dir })).toEqual({
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
  test("rejects an upload path that is a file", async () => {
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
              await expect(ctx.uploadStaticWebsite({ name: "app-web", dir: file })).rejects.toThrow(
                file,
              );
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
