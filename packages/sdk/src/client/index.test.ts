import { beforeEach, describe, expect, test, vi } from "vitest";
import { callResolver, configureResolvers, ResolverError, setResolverDefaults } from "./call";
import { resetResolverClient } from "./state";

const OPERATION = { field: "add", document: "query add($a: Int!) { add(a: $a) }" };

function respond(body: unknown, status = 200) {
  return vi.fn<typeof fetch>(async () => Response.json(body, { status }));
}

describe("callResolver", () => {
  beforeEach(() => {
    resetResolverClient();
  });

  test("posts the operation to the app's /query and returns the resolver's value", async () => {
    const fetcher = respond({ data: { add: 3 } });
    configureResolvers({ url: "https://app.erp.dev", fetch: fetcher });

    const result = await callResolver(OPERATION, { a: 1 });

    expect(result).toBe(3);
    expect(fetcher).toHaveBeenCalledWith("https://app.erp.dev/query", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: OPERATION.document, variables: { a: 1 } }),
    });
  });

  test("takes the url and fetch of an auth client passed as is", async () => {
    const fetcher = respond({ data: { add: 3 } });
    configureResolvers({ getAppUri: () => "https://xyz.erp.dev/", fetch: fetcher });

    await callResolver(OPERATION, { a: 1 });

    expect(fetcher.mock.calls[0]?.[0]).toBe("https://xyz.erp.dev/query");
  });

  test("falls back to the url the build was given when none is configured", async () => {
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(respond({ data: { add: 3 } }));
    setResolverDefaults({ url: "https://built.erp.dev" });

    await callResolver(OPERATION, { a: 1 });

    expect(fetcher.mock.calls[0]?.[0]).toBe("https://built.erp.dev/query");
    fetcher.mockRestore();
  });

  test("prefers the configured url over the one the build was given", async () => {
    const fetcher = respond({ data: { add: 3 } });
    setResolverDefaults({ url: "https://built.erp.dev" });
    configureResolvers({ url: "https://configured.erp.dev", fetch: fetcher });

    await callResolver(OPERATION, { a: 1 });

    expect(fetcher.mock.calls[0]?.[0]).toBe("https://configured.erp.dev/query");
  });

  test("fails with how to set the url when none is available", async () => {
    await expect(callResolver(OPERATION, { a: 1 })).rejects.toThrow(/configureResolvers/);
  });

  test("throws a resolver's error with its code and attributes", async () => {
    configureResolvers({
      url: "https://app.erp.dev",
      fetch: respond({
        data: null,
        errors: [
          {
            message: "access denied",
            extensions: { code: "RESOLVER_ERROR", attr: { name: "Authorization", error: "" } },
          },
        ],
      }),
    });

    const error = await callResolver(OPERATION, { a: 1 }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ResolverError);
    expect(error).toMatchObject({
      message: "access denied",
      code: "RESOLVER_ERROR",
      attr: { name: "Authorization", error: "" },
      status: 200,
    });
  });

  test("throws a gateway's rejection with its status", async () => {
    configureResolvers({
      url: "https://app.erp.dev",
      fetch: respond({ errors: [{ type: "Gateway", message: "unauthorized" }] }, 401),
    });

    const error = await callResolver(OPERATION, { a: 1 }).catch((e: unknown) => e);

    expect(error).toMatchObject({ message: "unauthorized", status: 401 });
  });

  test("throws with the status when the response is not GraphQL", async () => {
    configureResolvers({
      url: "https://app.erp.dev",
      fetch: vi.fn<typeof fetch>(async () => new Response("Bad Gateway", { status: 502 })),
    });

    const error = await callResolver(OPERATION, { a: 1 }).catch((e: unknown) => e);

    expect(error).toMatchObject({ message: expect.stringContaining("502"), status: 502 });
  });
});
