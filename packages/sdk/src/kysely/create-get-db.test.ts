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

  test("constructs tailordb.Client with temporal: false by default", () => {
    const constructorSpy = installStubClient();
    const getDB = createGetDB<{ ns: object }>();

    getDB("ns");

    expect(constructorSpy).toHaveBeenCalledWith({ namespace: "ns", temporal: false });
  });

  test("constructs tailordb.Client with the temporal setting given to createGetDB", () => {
    const constructorSpy = installStubClient();
    const getDB = createGetDB<{ ns: object }>({ temporal: true });

    getDB("ns");

    expect(constructorSpy).toHaveBeenCalledWith({ namespace: "ns", temporal: true });
  });

  test("ignores a temporal key smuggled into the getDB config", () => {
    const constructorSpy = installStubClient();
    const getDB = createGetDB<{ ns: object }>();

    // @ts-expect-error -- temporal is fixed by createGetDB, not per getDB call
    getDB("ns", { temporal: true });

    expect(constructorSpy).toHaveBeenCalledWith({ namespace: "ns", temporal: false });
  });
});
