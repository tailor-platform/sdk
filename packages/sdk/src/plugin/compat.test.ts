import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { beforeAll, describe, expect, test } from "vitest";
import { generate } from "#/cli/commands/generate/service";

describe("defineGenerators and definePlugins produce identical output", () => {
  const fixtureDir = path.resolve(__dirname, "../cli/commands/deploy/__test_fixtures__");
  const generatorsDir = path.join(fixtureDir, "generators-compat-out");
  const pluginsDir = path.join(fixtureDir, "plugins-compat-out");

  const collectFiles = (rootDir: string): string[] => {
    const files: string[] = [];
    const traverse = (currentDir: string) => {
      const entries = fs.readdirSync(currentDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".DS_Store") continue;
        const fullPath = path.join(currentDir, entry.name);
        if (entry.isDirectory()) {
          traverse(fullPath);
        } else {
          files.push(path.relative(rootDir, fullPath).split(path.sep).join("/"));
        }
      }
    };
    traverse(rootDir);
    return files.toSorted();
  };

  beforeAll(async () => {
    process.env.TAILOR_PLATFORM_WORKSPACE_ID ??= randomUUID();

    for (const dir of [generatorsDir, pluginsDir]) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true });
    }

    await generate({
      configPath: path.join(fixtureDir, "tailor.config.generators-compat.ts"),
    });
    await generate({
      configPath: path.join(fixtureDir, "tailor.config.plugins-compat.ts"),
    });
  }, 120000);

  test("plugin output includes all generated files from defineGenerators", () => {
    const generatorFiles = collectFiles(generatorsDir);
    const pluginFiles = collectFiles(pluginsDir);
    expect(generatorFiles.length).toBeGreaterThan(0);
    for (const file of generatorFiles) {
      expect(pluginFiles, `File ${file} missing from plugins output`).toContain(file);
    }
  });

  test("all files have identical content", () => {
    const files = collectFiles(generatorsDir);
    expect(files.length).toBeGreaterThan(0);

    const normalizeConfigPath = (content: string) =>
      content.replace(
        /tailor\.config\.(generators|plugins)-compat\.ts/g,
        "tailor.config.compat.ts",
      );

    for (const file of files) {
      const generatorContent = normalizeConfigPath(
        fs.readFileSync(path.join(generatorsDir, file), "utf-8"),
      );
      const pluginContent = normalizeConfigPath(
        fs.readFileSync(path.join(pluginsDir, file), "utf-8"),
      );
      expect(pluginContent, `Content mismatch in ${file}`).toBe(generatorContent);
    }
  });
});
