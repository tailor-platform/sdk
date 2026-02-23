import fs from "node:fs";
import path from "node:path";
import { describe, expect, test } from "vitest";

describe("defineGenerators and definePlugins produce identical output", () => {
  const generatorsDir = path.join(__dirname, "fixtures/generators");
  const pluginsDir = path.join(__dirname, "fixtures/plugins");

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
    return files.sort();
  };

  test("both directories produce the same file list", () => {
    const generatorFiles = collectFiles(generatorsDir);
    const pluginFiles = collectFiles(pluginsDir);
    expect(pluginFiles).toEqual(generatorFiles);
  });

  test("all files have identical content", () => {
    const files = collectFiles(generatorsDir);
    expect(files.length).toBeGreaterThan(0);

    // The seed exec.mjs embeds the config path, so we normalize it for comparison
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
      expect(
        pluginContent,
        `Content mismatch in ${file}:\n  diff ${path.join(generatorsDir, file)} ${path.join(pluginsDir, file)}`,
      ).toBe(generatorContent);
    }
  });
});
