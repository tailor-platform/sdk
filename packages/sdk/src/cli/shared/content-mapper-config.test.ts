import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { isContentMapperEnabled } from "./content-mapper-config";
import { tempDir } from "./test-helpers/temp-dir";

const MAPPER = { contentMappers: [{ package: "@tailor-platform/sdk", extensions: [".tailor"] }] };

function write(file: string, content: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, typeof content === "string" ? content : JSON.stringify(content));
}

describe("isContentMapperEnabled", () => {
  test("is true when the tsconfig next to the config enables the mapper", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), MAPPER);
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(true);
  });

  test("is true when the tsconfig inherits the mapper through extends", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.base.json"), MAPPER);
    write(path.join(t.dir, "packages", "app", "tsconfig.json"), {
      extends: "../../tsconfig.base.json",
    });
    write(path.join(t.dir, "packages", "app", "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "packages", "app", "tailor.config.ts"))).toBe(
      true,
    );
  });

  test("is true when the tsconfig that includes the config sits in a parent directory", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), MAPPER);
    write(path.join(t.dir, "packages", "app", "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "packages", "app", "tailor.config.ts"))).toBe(
      true,
    );
  });

  test("looks past a nearer tsconfig that does not include the config", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), MAPPER);
    write(path.join(t.dir, "packages", "app", "tsconfig.json"), { include: ["src"] });
    write(path.join(t.dir, "packages", "app", "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "packages", "app", "tailor.config.ts"))).toBe(
      true,
    );
  });

  test("is false when the only tsconfig that enables the mapper does not include the config", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), { ...MAPPER, include: ["src"] });
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(false);
  });

  test("is false when the tsconfig does not enable the mapper", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), { compilerOptions: { strict: true } });
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(false);
  });

  test.each([
    {
      name: "a mapper for another package",
      contentMappers: [{ package: "other-mapper", extensions: [".tailor"] }],
    },
    {
      name: "the SDK's mapper without the .tailor extension",
      contentMappers: [{ package: "@tailor-platform/sdk", extensions: [".sql"] }],
    },
  ])("is false for $name", ({ contentMappers }) => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), { contentMappers });
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(false);
  });

  test("is false when the mapper is enabled only in a project the tsconfig references", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), {
      files: [],
      references: [{ path: "./tsconfig.app.json" }],
    });
    write(path.join(t.dir, "tsconfig.app.json"), MAPPER);
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(false);
  });

  test("is false when there is no tsconfig", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(false);
  });

  test("is false, without throwing, when the tsconfig cannot be read", () => {
    using t = tempDir("mapper-config-");
    write(path.join(t.dir, "tsconfig.json"), "{ not json");
    write(path.join(t.dir, "tailor.config.ts"), "");

    expect(isContentMapperEnabled(path.join(t.dir, "tailor.config.ts"))).toBe(false);
  });
});
