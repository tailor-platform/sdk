import { afterEach, describe, expect, test, vi } from "vitest";

const GATE = "__TAILOR_PLATFORM_BUNDLE_KYSELY_TEMPORAL";

async function getDBWith(gate: string | undefined) {
  vi.resetModules();
  const Client = vi.fn();
  vi.stubGlobal("tailordb", { Client });
  if (gate === undefined) vi.stubEnv(GATE, undefined);
  else vi.stubEnv(GATE, gate);
  const { getDB } = await import("./db");
  // `getDB` is typed for a namespace map the project's `.tailor` file declares.
  (getDB as (namespace: string) => unknown)("main");
  return Client;
}

describe("getDB", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  test("reads Temporal values when the bundle gate says the plugin is configured with temporal", async () => {
    expect(await getDBWith("true")).toHaveBeenCalledWith({ namespace: "main", temporal: true });
  });

  test("reads Date and string values when the gate is absent", async () => {
    expect(await getDBWith(undefined)).toHaveBeenCalledWith({ namespace: "main" });
  });
});
