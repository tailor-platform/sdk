import { afterEach, describe, expect, test, vi } from "vitest";
import { createGetDB } from "./index";

type StubGlobal = { tailordb?: { Client: typeof tailordb.Client } };

function installStubClient() {
  const constructorSpy = vi.fn();
  class StubClient {
    constructor(config: { namespace: string; temporal?: boolean }) {
      constructorSpy(config);
    }
    async connect(): Promise<void> {}
    async end(): Promise<void> {}
    async queryObject<O>(): Promise<tailordb.QueryResult<O>> {
      return { rows: [], command: "SELECT", rowCount: 0 };
    }
  }
  (globalThis as unknown as StubGlobal).tailordb = { Client: StubClient };
  return constructorSpy;
}

describe("createGetDB", () => {
  afterEach(() => {
    delete (globalThis as unknown as StubGlobal).tailordb;
  });

  test("constructs tailordb.Client with temporal: undefined when no config is given", () => {
    const constructorSpy = installStubClient();
    const getDB = createGetDB<{ ns: object }>();

    getDB("ns");

    expect(constructorSpy).toHaveBeenCalledWith({ namespace: "ns", temporal: undefined });
  });

  test("passes temporal: true through to tailordb.Client", () => {
    const constructorSpy = installStubClient();
    const getDB = createGetDB<{ ns: object }>();

    getDB("ns", { temporal: true });

    expect(constructorSpy).toHaveBeenCalledWith({ namespace: "ns", temporal: true });
  });

  test("does not forward temporal into the Kysely dialect config", () => {
    const constructorSpy = installStubClient();
    const getDB = createGetDB<{ ns: object }>();

    // Kysely's own config keys (e.g. plugins) must still reach Kysely; temporal must not.
    const db = getDB("ns", { temporal: true, plugins: [] });

    expect(constructorSpy).toHaveBeenCalledWith({ namespace: "ns", temporal: true });
    expect(db).toBeDefined();
  });
});
