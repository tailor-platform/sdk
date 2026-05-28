import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { findHttpAdaptersInFile } from "./detector";

function detect(source: string) {
  const { program } = parseSync("adapter.ts", source);
  return findHttpAdaptersInFile(program, "/virtual/adapter.ts");
}

describe("findHttpAdaptersInFile", () => {
  it("detects a createHttpAdapter call and extracts the name", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
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
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
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
import { createHttpAdapter } from "@tailor-platform/sdk";
const dynamicName = "x";
export default createHttpAdapter({
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
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
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
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
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
import { createHttpAdapter } from "@tailor-platform/sdk";
const handler = () => ({ query: "{}" });
export default createHttpAdapter({
  name: "ref-input",
  pathPattern: "/x",
  methods: ["GET"],
  input: handler,
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`input` to be a function expression/);
  });

  it("errors when multiple createHttpAdapter calls exist in one file", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";

export const a = createHttpAdapter({
  name: "one",
  pathPattern: "/a",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});

export default createHttpAdapter({
  name: "two",
  pathPattern: "/b",
  methods: ["GET"],
  input: () => ({ query: "{}" }),
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(
      /Expected exactly one createHttpAdapter call per file/,
    );
  });

  it("ignores files that do not call createHttpAdapter", () => {
    const result = detect(`
import { createWorkflow } from "@tailor-platform/sdk";
export default createWorkflow({});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors).toEqual([]);
  });
});
