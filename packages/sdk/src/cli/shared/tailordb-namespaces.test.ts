import { describe, expect, test, vi } from "vitest";
import { loadTailorDBNamespaces } from "./tailordb-namespaces";

vi.mock("./config-loader", () => ({
  loadConfig: async () => ({ config: { path: "/proj/tailor.config.ts" }, plugins: [] }),
}));
vi.mock("./type-generator", () => ({ generateUserTypes: async () => {} }));
vi.mock("#/cli/services/application", () => ({
  defineApplication: () => ({ tailorDBServices: [{ namespace: "main-db" }] }),
}));

describe("loadTailorDBNamespaces", () => {
  test("reports a namespace the config does not own as TAILORDB_NAMESPACE_NOT_FOUND", async () => {
    await expect(loadTailorDBNamespaces({ namespaces: ["other-db"] })).rejects.toMatchObject({
      code: "TAILORDB_NAMESPACE_NOT_FOUND",
      message:
        'TailorDB namespace "other-db" not found in local config.db. Available owned namespaces: main-db',
      context: { namespaces: ["other-db"], available: ["main-db"] },
    });
  });
});
