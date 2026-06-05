import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { resolveWatchPaths } from "./serve";
import type { ErdBuildResult } from "./export";
import type { LocalErdSchemaContext } from "./local-schema";

describe("resolveWatchPaths", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-erd-watch-"));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  test("expands TailorDB file globs and includes the literal base directory", async () => {
    const configPath = path.join(tempDir, "tailor.config.ts");
    const typeDir = path.join(tempDir, "tailordb");
    const typeFile = path.join(typeDir, "user.ts");
    fs.writeFileSync(configPath, "export default {};");
    fs.mkdirSync(typeDir);
    fs.writeFileSync(typeFile, "export const User = {};");

    const context = {
      config: {
        path: configPath,
        db: {
          main: {
            files: [path.join(typeDir, "*.ts")],
          },
        },
      },
      namespaces: [],
    } as unknown as LocalErdSchemaContext;
    const results = [{ namespace: "main" }] as ErdBuildResult[];

    const paths = await resolveWatchPaths(context, results);

    expect(paths).toContain(configPath);
    expect(paths).toContain(typeFile);
    expect(paths).toContain(typeDir);
    expect(paths).not.toContain(path.join(typeDir, "*.ts"));
  });
});
