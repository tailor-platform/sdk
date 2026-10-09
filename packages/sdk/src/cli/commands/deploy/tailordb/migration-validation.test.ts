import { describe, expect, test } from "vitest";
import { captureStderr } from "#/cli/shared/test-helpers/capture-output";
import { warnUnsetMaintenanceMode } from "./migration-validation";
import type { PendingMigration } from "#/cli/commands/tailordb/migrate/types";
import type { LoadedConfig } from "#/cli/shared/config-loader";

const pending = [
  { namespace: "main", number: 2 },
  { namespace: "main", number: 3 },
  { namespace: "audit", number: 1 },
] as PendingMigration[];

describe("warnUnsetMaintenanceMode", () => {
  test("recommends maintenance mode when the config leaves it unset", () => {
    using stderr = captureStderr();

    warnUnsetMaintenanceMode({ path: "/app/tailor.config.ts" } as LoadedConfig, pending);

    expect(stderr.output).toContain("namespaces main, audit");
    expect(stderr.output).toContain("maintenanceMode");
    expect(stderr.output).toContain("tailor.config.ts");
  });

  test.each([false, "migration", "deploy"] as const)(
    "stays quiet when maintenanceMode is %j",
    (maintenanceMode) => {
      using stderr = captureStderr();

      warnUnsetMaintenanceMode(
        { path: "/app/tailor.config.ts", maintenanceMode } as LoadedConfig,
        pending,
      );

      expect(stderr.output).toBe("");
    },
  );

  test("stays quiet without pending migrations", () => {
    using stderr = captureStderr();

    warnUnsetMaintenanceMode({ path: "/app/tailor.config.ts" } as LoadedConfig, []);

    expect(stderr.output).toBe("");
  });
});
