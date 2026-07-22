import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aroundEach, describe, expect, test } from "vitest";
import { loadWorkspaceContext, saveWorkspaceContext } from "./workspace-context";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "tailor-sdk-workspace-context-"));
  temporaryDirectories.push(directory);
  return directory;
}

aroundEach(async (runTest) => {
  await runTest();
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })),
  );
});

describe("workspace context", () => {
  test("persists and reloads a context for the current platform", async () => {
    const projectDirectory = await temporaryDirectory();
    const configPath = join(projectDirectory, "tailor.config.ts");
    const context = {
      version: 1 as const,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    };

    await saveWorkspaceContext(context, configPath);

    await expect(loadWorkspaceContext("https://api.tailor.tech", configPath)).resolves.toEqual(
      context,
    );
    await expect(
      readFile(join(projectDirectory, ".tailor-sdk", "tailor.config.ts.context.json"), "utf8"),
    ).resolves.toBe(`${JSON.stringify(context, null, 2)}\n`);
  });

  test("keeps contexts separate for configuration files in the same directory", async () => {
    const projectDirectory = await temporaryDirectory();
    const firstConfigPath = join(projectDirectory, "first.config.ts");
    const secondConfigPath = join(projectDirectory, "second.config.ts");
    const firstContext = {
      version: 1 as const,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    };
    const secondContext = {
      ...firstContext,
      workspaceId: "22222222-2222-4222-8222-222222222222",
    };

    await saveWorkspaceContext(firstContext, firstConfigPath);
    await saveWorkspaceContext(secondContext, secondConfigPath);

    await expect(loadWorkspaceContext("https://api.tailor.tech", firstConfigPath)).resolves.toEqual(
      firstContext,
    );
    await expect(
      loadWorkspaceContext("https://api.tailor.tech", secondConfigPath),
    ).resolves.toEqual(secondContext);
    await expect(readdir(join(projectDirectory, ".tailor-sdk"))).resolves.toEqual([
      "first.config.ts.context.json",
      "second.config.ts.context.json",
    ]);
  });

  test("does not reuse a context after the application ID changes", async () => {
    const projectDirectory = await temporaryDirectory();
    const configPath = join(projectDirectory, "tailor.config.ts");
    const context = {
      version: 1 as const,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    };

    await saveWorkspaceContext(context, configPath, "application-a");

    await expect(
      loadWorkspaceContext(context.platformUrl, configPath, "application-a"),
    ).resolves.toMatchObject({ ...context, applicationId: "application-a" });
    await expect(
      loadWorkspaceContext(context.platformUrl, configPath, "application-b"),
    ).resolves.toBeUndefined();
  });

  test("does not rewrite an unchanged context", async () => {
    const projectDirectory = await temporaryDirectory();
    const configPath = join(projectDirectory, "tailor.config.ts");
    const targetPath = join(projectDirectory, ".tailor-sdk", "tailor.config.ts.context.json");
    const context = {
      version: 1 as const,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    };

    await saveWorkspaceContext(context, configPath, "application-a");
    const first = await stat(targetPath);
    await saveWorkspaceContext(context, configPath, "application-a");
    const second = await stat(targetPath);

    expect(second.ino).toBe(first.ino);
  });

  test("supports concurrent saves from the same process", async () => {
    const projectDirectory = await temporaryDirectory();
    const configPath = join(projectDirectory, "tailor.config.ts");
    const context = {
      version: 1 as const,
      platformUrl: "https://api.tailor.tech",
      workspaceId: "11111111-1111-4111-8111-111111111111",
    };

    await expect(
      Promise.all(Array.from({ length: 20 }, () => saveWorkspaceContext(context, configPath))),
    ).resolves.toHaveLength(20);
    await expect(loadWorkspaceContext(context.platformUrl, configPath)).resolves.toEqual(context);
  });

  test("removes the temporary file when the atomic rename fails", async () => {
    const projectDirectory = await temporaryDirectory();
    const configPath = join(projectDirectory, "tailor.config.ts");
    const stateDirectory = join(projectDirectory, ".tailor-sdk");
    const targetPath = join(stateDirectory, "tailor.config.ts.context.json");
    await mkdir(targetPath, { recursive: true });

    await expect(
      saveWorkspaceContext(
        {
          version: 1,
          platformUrl: "https://api.tailor.tech",
          workspaceId: "11111111-1111-4111-8111-111111111111",
        },
        configPath,
      ),
    ).rejects.toThrow(/rename/);
    await expect(readdir(stateDirectory)).resolves.toEqual(["tailor.config.ts.context.json"]);
  });

  test.each([
    ["missing", undefined],
    ["malformed", "not json"],
    ["stale schema", JSON.stringify({ version: 1 })],
    [
      "another platform",
      JSON.stringify({
        version: 1,
        platformUrl: "https://another.example.com",
        workspaceId: "11111111-1111-4111-8111-111111111111",
      }),
    ],
  ])("rejects %s context", async (_name, contents) => {
    const projectDirectory = await temporaryDirectory();
    const configPath = join(projectDirectory, "tailor.config.ts");
    if (contents !== undefined) {
      const stateDirectory = join(projectDirectory, ".tailor-sdk");
      await mkdir(stateDirectory, { recursive: true });
      await writeFile(join(stateDirectory, "tailor.config.ts.context.json"), contents);
    }

    await expect(
      loadWorkspaceContext("https://api.tailor.tech", configPath),
    ).resolves.toBeUndefined();
  });
});
