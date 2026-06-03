import { describe, expect, it } from "vitest";
import { HttpAdapterConfigSchema, HttpAdapterServiceInputSchema } from "./schema";

const baseConfig = {
  name: "get-user",
  pathPattern: "/users/*",
  input: {
    get: (req: unknown) => ({ query: "{ me { id } }", variables: { req } }),
  },
};

describe("HttpAdapterConfigSchema", () => {
  it("accepts a minimal valid config", () => {
    const result = HttpAdapterConfigSchema.safeParse(baseConfig);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.enabled).toBe(true);
      expect(result.data.priority).toBe(0);
    }
  });

  it("accepts a config with an output function", () => {
    const result = HttpAdapterConfigSchema.safeParse({
      ...baseConfig,
      output: () => ({ body: "" }),
    });
    expect(result.success).toBe(true);
  });

  it("accepts multiple method handlers", () => {
    const result = HttpAdapterConfigSchema.safeParse({
      ...baseConfig,
      input: {
        get: () => ({ query: "{}" }),
        post: () => ({ query: "{}" }),
        delete: () => ({ query: "{}" }),
      },
    });
    expect(result.success).toBe(true);
  });

  it("rejects a name that doesn't match the pattern", () => {
    const result = HttpAdapterConfigSchema.safeParse({ ...baseConfig, name: "Invalid Name" });
    expect(result.success).toBe(false);
  });

  it("rejects a name shorter than 3 chars", () => {
    const result = HttpAdapterConfigSchema.safeParse({ ...baseConfig, name: "ab" });
    expect(result.success).toBe(false);
  });

  it("rejects a name starting with a hyphen", () => {
    const result = HttpAdapterConfigSchema.safeParse({ ...baseConfig, name: "-foo" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty input object", () => {
    const result = HttpAdapterConfigSchema.safeParse({ ...baseConfig, input: {} });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown HTTP method key", () => {
    const result = HttpAdapterConfigSchema.safeParse({
      ...baseConfig,
      input: { options: () => ({ query: "{}" }) },
    });
    expect(result.success).toBe(false);
  });

  it("rejects a typo alongside a valid handler instead of silently stripping it", () => {
    // Without `.strictObject()`, `delte` would be silently dropped and the
    // config would parse successfully — a confusing footgun where the user
    // thinks they've registered a DELETE handler but actually only have GET.
    const result = HttpAdapterConfigSchema.safeParse({
      ...baseConfig,
      input: {
        get: () => ({ query: "{}" }),
        delte: () => ({ query: "{}" }),
      },
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown top-level key instead of silently stripping it", () => {
    // Without `.strictObject()`, a typo like `outpu` (for `output`) would be
    // silently dropped, leaving the user puzzled why their handler never runs.
    const result = HttpAdapterConfigSchema.safeParse({
      ...baseConfig,
      outpu: () => ({ body: "" }),
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty pathPattern", () => {
    const result = HttpAdapterConfigSchema.safeParse({ ...baseConfig, pathPattern: "" });
    expect(result.success).toBe(false);
  });

  it("rejects a negative priority", () => {
    const result = HttpAdapterConfigSchema.safeParse({ ...baseConfig, priority: -1 });
    expect(result.success).toBe(false);
  });

  it("rejects a missing input object", () => {
    const { input: _omit, ...without } = baseConfig;
    void _omit;
    const result = HttpAdapterConfigSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it("rejects a non-function handler", () => {
    const result = HttpAdapterConfigSchema.safeParse({
      ...baseConfig,
      input: { get: "not a function" },
    });
    expect(result.success).toBe(false);
  });
});

describe("HttpAdapterServiceInputSchema", () => {
  it("accepts a config with files", () => {
    const result = HttpAdapterServiceInputSchema.safeParse({ files: ["adapters/**/*.ts"] });
    expect(result.success).toBe(true);
  });

  it("rejects an empty files array", () => {
    const result = HttpAdapterServiceInputSchema.safeParse({ files: [] });
    expect(result.success).toBe(false);
  });
});
