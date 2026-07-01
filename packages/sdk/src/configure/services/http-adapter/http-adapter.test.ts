import { describe, expect, expectTypeOf, test } from "vitest";
import { SDK_BRAND, isSdkBranded } from "#/utils/brand";
import {
  createHttpAdapter,
  type HttpAdapterInputFn,
  type HttpAdapterTypedDocumentNode,
} from "./http-adapter";
import type { TypedQueryDocumentNode } from "graphql";

describe("createHttpAdapter", () => {
  test("returns a branded HTTP adapter object", () => {
    const adapter = createHttpAdapter({
      name: "get-user",
      pathPattern: "/users/*",
      input: {
        get: () => ({ query: "{ me { id } }" }),
      },
    });

    expect(adapter.name).toBe("get-user");
    expect(adapter.pathPattern).toBe("/users/*");
    expect(typeof adapter.input.get).toBe("function");
    expect(isSdkBranded(adapter, "http-adapter")).toBe(true);
  });

  test("hides the brand symbol from enumeration", () => {
    const adapter = createHttpAdapter({
      name: "get-user",
      pathPattern: "/users/*",
      input: {
        get: () => ({ query: "{ me { id } }" }),
      },
    });
    // The brand symbol is an own property...
    expect(Object.getOwnPropertySymbols(adapter)).toContain(SDK_BRAND);
    // ...but non-enumerable, so it is hidden from enumeration / spread.
    expect(Object.getOwnPropertyDescriptor(adapter, SDK_BRAND)?.enumerable).toBe(false);
    expect(Object.getOwnPropertySymbols({ ...adapter })).not.toContain(SDK_BRAND);
  });

  test("preserves the output function when provided", () => {
    const output = () => ({ body: "" });
    const adapter = createHttpAdapter({
      name: "get-user",
      pathPattern: "/users/*",
      input: {
        get: () => ({ query: "{}" }),
      },
      output,
    });
    expect(adapter.output).toBe(output);
  });

  test("accepts multiple per-method handlers", () => {
    const adapter = createHttpAdapter({
      name: "user",
      pathPattern: "/users/*",
      input: {
        get: () => ({ query: "{}" }),
        post: () => ({ query: "{}" }),
        delete: () => ({ query: "{}" }),
      },
    });
    expect(typeof adapter.input.get).toBe("function");
    expect(typeof adapter.input.post).toBe("function");
    expect(typeof adapter.input.delete).toBe("function");
  });

  test("infers output data and variables from typed document nodes", () => {
    type GetUserData = { user: { id: string; name: string } | null };
    type GetUserVariables = { id: string };
    const getUserDocument = {} as HttpAdapterTypedDocumentNode<GetUserData, GetUserVariables>;
    const get: HttpAdapterInputFn<typeof getUserDocument> = (req) => ({
      query: getUserDocument,
      variables: { id: req.path.split("/")[2] ?? "" },
    });

    createHttpAdapter({
      name: "typed-user",
      pathPattern: "/users/*",
      input: {
        get,
      },
      output: (resp) => {
        expectTypeOf(resp.data).toEqualTypeOf<GetUserData | null | undefined>();
        expectTypeOf(resp.data?.user?.name).toEqualTypeOf<string | undefined>();
        return { body: JSON.stringify(resp.data?.user ?? null) };
      },
    });

    createHttpAdapter({
      name: "typed-missing-variables",
      pathPattern: "/users/*",
      input: {
        // @ts-expect-error - typed document variables require variables.id
        get: () => ({
          query: getUserDocument,
        }),
      },
    });

    createHttpAdapter({
      name: "typed-wrong-variables",
      pathPattern: "/users/*",
      input: {
        // @ts-expect-error - typed document variables require an id string
        get: () => ({
          query: getUserDocument,
          variables: { slug: "alice" },
        }),
      },
    });
  });

  test("unions output data from multiple typed document methods", () => {
    type GetData = { getUser: { id: string } | null };
    type PostData = { createUser: { id: string } };
    const getDocument = {} as HttpAdapterTypedDocumentNode<GetData>;
    const postDocument = {} as TypedQueryDocumentNode<PostData, { name: string }>;

    createHttpAdapter({
      name: "typed-union",
      pathPattern: "/users/*",
      input: {
        get: () => ({
          query: getDocument,
        }),
        post: () => ({
          query: postDocument,
          variables: { name: "Alice" },
        }),
      },
      output: (resp) => {
        expectTypeOf(resp.data).toEqualTypeOf<GetData | PostData | null | undefined>();
        return { body: JSON.stringify(resp.data ?? null) };
      },
    });
  });
});
