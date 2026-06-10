import { describe, expect, test } from "vitest";
import { SDK_BRAND, isSdkBranded } from "@/utils/brand";
import { createHttpAdapter } from "./http-adapter";

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
});
