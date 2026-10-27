import { describe, expect, test } from "vitest";
import { getNamespacesWithMigrations } from "./config";
import type { AppConfig } from "#/configure/config/types";

function configWith(db: Record<string, { migration?: { directory: string } }>): AppConfig {
  return { name: "app", db } as unknown as AppConfig;
}

describe("getNamespacesWithMigrations", () => {
  test("resolves each migration directory against the config directory", () => {
    const result = getNamespacesWithMigrations(
      configWith({
        tailordb: { migration: { directory: "./migrations/tailordb" } },
        analyticsdb: { migration: { directory: "./migrations/analyticsdb" } },
        plain: {},
      }),
      "/work/app",
    );

    expect(result).toEqual([
      { namespace: "tailordb", migrationsDir: "/work/app/migrations/tailordb" },
      { namespace: "analyticsdb", migrationsDir: "/work/app/migrations/analyticsdb" },
    ]);
  });

  test("rejects namespaces that share the same resolved directory", () => {
    const run = () =>
      getNamespacesWithMigrations(
        configWith({
          tailordb: { migration: { directory: "./migrations" } },
          analyticsdb: { migration: { directory: "migrations/" } },
        }),
        "/work/app",
      );

    expect(run).toThrow(
      expect.objectContaining({
        code: "MIGRATION_DIRECTORY_CONFLICT",
        context: {
          conflicts: [
            { directory: "/work/app/migrations", namespaces: ["tailordb", "analyticsdb"] },
          ],
        },
      }),
    );
  });

  test("reports every namespace on a shared directory and every shared directory at once", () => {
    const run = () =>
      getNamespacesWithMigrations(
        configWith({
          tailordb: { migration: { directory: "./migrations" } },
          analyticsdb: { migration: { directory: "./migrations" } },
          billingdb: { migration: { directory: "./migrations" } },
          crmdb: { migration: { directory: "./crm" } },
          erpdb: { migration: { directory: "./crm" } },
          plain: { migration: { directory: "./plain" } },
        }),
        "/work/app",
      );

    expect(run).toThrow(
      expect.objectContaining({
        code: "MIGRATION_DIRECTORY_CONFLICT",
        context: {
          conflicts: [
            {
              directory: "/work/app/migrations",
              namespaces: ["tailordb", "analyticsdb", "billingdb"],
            },
            { directory: "/work/app/crm", namespaces: ["crmdb", "erpdb"] },
          ],
        },
      }),
    );
  });
});
