import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { findHttpAdaptersInFile } from "./detector";

function detect(source: string) {
  const { program } = parseSync("adapter.ts", source);
  return findHttpAdaptersInFile(program, "/virtual/adapter.ts");
}

describe("findHttpAdaptersInFile", () => {
  it("detects a defineHttpAdapter call and extracts the name", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";

export default defineHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  methods: ["GET"],
  input: (req) => ({ query: "{}" }),
});
`);
    expect(result.errors).toEqual([]);
    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0].name).toBe("get-user");
    expect(result.adapters[0].hasOutput).toBe(false);
  });

  it("marks adapters that include an output handler", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";

export default defineHttpAdapter({
  name: "with-output",
  pathPattern: "/x",
  methods: ["POST"],
  input: () => ({ query: "{}" }),
  output: () => ({ body: "" }),
});
`);
    expect(result.errors).toEqual([]);
    expect(result.adapters[0].hasOutput).toBe(true);
  });

  it("errors when the name is not a string literal", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";
const dynamicName = "x";
export default defineHttpAdapter({
  name: dynamicName,
  pathPattern: "/x",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/static string `name`/);
  });

  it("errors when input is async", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";
export default defineHttpAdapter({
  name: "async-input",
  pathPattern: "/x",
  methods: ["GET"],
  input: async () => ({ query: "{}" }),
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`input` must be synchronous/);
  });

  it("errors when output is async", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";
export default defineHttpAdapter({
  name: "async-output",
  pathPattern: "/x",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
  output: async () => ({ body: "" }),
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`output` must be synchronous/);
  });

  it("errors when input is not a function expression", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";
const handler = () => ({ query: "{}" });
export default defineHttpAdapter({
  name: "ref-input",
  pathPattern: "/x",
  methods: ["GET"],
  input: handler,
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`input` to be a function expression/);
  });

  it("errors when multiple defineHttpAdapter calls exist in one file", () => {
    const result = detect(`
import { defineHttpAdapter } from "@tailor-platform/sdk";

export const a = defineHttpAdapter({
  name: "one",
  pathPattern: "/a",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});

export default defineHttpAdapter({
  name: "two",
  pathPattern: "/b",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(
      /Expected exactly one defineHttpAdapter call per file/,
    );
  });

  it("ignores files that do not call defineHttpAdapter", () => {
    const result = detect(`
import { createWorkflow } from "@tailor-platform/sdk";
export default createWorkflow({});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
