import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "pathe";
import { runCommand } from "politty";
import { afterEach, beforeEach, describe, expect, test, vi, type Mock } from "vitest";

type MockProcedure = (...args: Parameters<Mock>) => ReturnType<Mock>;
import { initOperatorClient } from "@/cli/shared/client";
import { loadConfig } from "@/cli/shared/config-loader";
import { captureStdout } from "@/cli/shared/test-helpers/capture-output";
import { jsonMode } from "@/cli/shared/test-helpers/json-mode";
import { statusCommand } from "./status";

const state = vi.hoisted(() => ({
  migrationsDir: "",
  getMetadata: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/config-loader", () => ({
  loadConfig: vi.fn<MockProcedure>(),
}));

vi.mock("@/cli/shared/context", () => ({
  loadAccessToken: vi.fn<MockProcedure>().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn<MockProcedure>().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
}));

vi.mock("@/cli/shared/client", () => ({
  initOperatorClient: vi.fn<MockProcedure>(),
}));

function writeDiff(number: number, description: string): void {
  const dir = path.join(state.migrationsDir, number.toString().padStart(4, "0"));
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "diff.json"),
    JSON.stringify({
      namespace: "tailordb",
      description,
    }),
  );
}

describe("tailordb migration status --json", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "tailordb-migration-status-json-test-"));
    state.migrationsDir = path.join(tmpDir, "migrations");
    fs.mkdirSync(path.join(state.migrationsDir, "0000"), { recursive: true });
    fs.writeFileSync(path.join(state.migrationsDir, "0000", "schema.json"), "{}");
    writeDiff(1, "Add users");
    writeDiff(2, "Add orders");

    vi.mocked(loadConfig).mockResolvedValue({
      config: {
        path: path.join(tmpDir, "tailor.config.ts"),
        db: {
          tailordb: {
            migration: {
              directory: state.migrationsDir,
            },
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof loadConfig>>);

    state.getMetadata.mockResolvedValue({
      metadata: {
        labels: {
          "sdk-migration": "m0001",
        },
      },
    });
    vi.mocked(initOperatorClient).mockResolvedValue({
      getMetadata: state.getMetadata,
    } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test("emits a parseable JSON array of namespace migration statuses", async () => {
    using stdout = captureStdout();
    using _stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    using _json = jsonMode();

    await runCommand(statusCommand, []);

    expect(stdout.output).not.toBe("");
    expect(JSON.parse(stdout.output)).toEqual([
      {
        namespace: "tailordb",
        currentMigration: 1,
        currentMigrationLabel: "0001",
        pendingMigrations: [
          {
            number: 2,
            label: "0002",
            description: "Add orders",
          },
        ],
      },
    ]);
  });
});
