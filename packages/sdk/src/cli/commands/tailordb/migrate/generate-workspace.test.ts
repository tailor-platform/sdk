import * as fs from "node:fs";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { silenceLogger } from "#/cli/shared/test-helpers/silence-logger";
import { writeWorkspaceProject } from "#/cli/shared/test-helpers/workspace-config";
import { generate } from "./generate";

describe("tailordb migration generate with a workspace config", () => {
  let dir: string;
  let configPath: string;

  beforeEach(() => {
    dir = fs.realpathSync(fs.mkdtempSync(path.join(import.meta.dirname, ".workspace-generate-")));
    configPath = writeWorkspaceProject(dir, {
      db: `{
    "customer-db": { files: ["./db/customer/*.ts"] },
    "order-db": { files: ["./db/order/*.ts"] },
    "ledger-db": { files: ["./db/ledger/*.ts"], migration: { directory: "./migrations/ledger" } },
  }`,
    });
    vi.stubEnv("TAILOR_BUILD_OUTPUT_DIR", path.join(dir, ".tailor"));
    vi.stubEnv("EDITOR", undefined);
    vi.stubEnv("VISUAL", undefined);
    silenceLogger("log", "info", "success", "warn", "debug");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  test("generates the migration of a namespace no application lists", async () => {
    const result = await generate({ configPath, yes: true });

    expect(result.migrations.map((migration) => migration.namespace)).toEqual(["ledger-db"]);
  });
});
