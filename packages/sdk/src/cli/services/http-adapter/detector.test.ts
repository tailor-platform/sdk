import { parseSync } from "oxc-parser";
import { describe, expect, it } from "vitest";
import { findHttpAdaptersInFile } from "./detector";

function detect(source: string) {
  const { program } = parseSync("adapter.ts", source);
  return findHttpAdaptersInFile(program, "/virtual/adapter.ts");
}

describe("findHttpAdaptersInFile", () => {
  it("detects a createHttpAdapter call and extracts the name and methods", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "get-user",
  pathPattern: "/users/*",
  input: {
    get: (req) => ({ query: "{}" }),
  },
});
`);
    expect(result.errors).toEqual([]);
    expect(result.adapters).toHaveLength(1);
    expect(result.adapters[0].name).toBe("get-user");
    expect(result.adapters[0].methods).toEqual(["get"]);
    expect(result.adapters[0].hasOutput).toBe(false);
  });

  it("captures multiple method handlers", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "user",
  pathPattern: "/users/*",
  input: {
    get:    (req) => ({ query: "{}" }),
    post:   (req) => ({ query: "{}" }),
    delete: (req) => ({ query: "{}" }),
  },
});
`);
    expect(result.errors).toEqual([]);
    expect(result.adapters[0].methods).toEqual(["get", "post", "delete"]);
  });

  it("marks adapters that include an output handler", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";

export default createHttpAdapter({
  name: "with-output",
  pathPattern: "/x",
  input: {
    post: () => ({ query: "{}" }),
  },
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
  input: { get: () => ({ query: "{}" }) },
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/static string `name`/);
  });

  it("errors when input is not an object literal", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";
const handlers = { get: () => ({ query: "{}" }) };
export default createHttpAdapter({
  name: "ref-input",
  pathPattern: "/x",
  input: handlers,
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`input` must be an object literal/);
  });

  it("errors when input has no method handlers", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "empty-input",
  pathPattern: "/x",
  input: {},
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/at least one HTTP method handler/);
  });

  it("errors when a method handler is not a function expression", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";
const handler = () => ({ query: "{}" });
export default createHttpAdapter({
  name: "ref-handler",
  pathPattern: "/x",
  input: { get: handler },
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`input\.get` must be a function expression/);
  });

  it("errors when a method handler is async", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "async-input",
  pathPattern: "/x",
  input: { get: async () => ({ query: "{}" }) },
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`input\.get` must be synchronous/);
  });

  it("errors when output is async", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";
export default createHttpAdapter({
  name: "async-output",
  pathPattern: "/x",
  input: { get: () => ({ query: "{}" }) },
  output: async () => ({ body: "" }),
});
`);
    expect(result.adapters).toEqual([]);
    expect(result.errors[0].message).toMatch(/`output` must be synchronous/);
  });

  it("errors when multiple createHttpAdapter calls exist in one file", () => {
    const result = detect(`
import { createHttpAdapter } from "@tailor-platform/sdk";

export const a = createHttpAdapter({
  name: "one",
  pathPattern: "/a",
  input: { get: () => ({ query: "{}" }) },
});

export default createHttpAdapter({
  name: "two",
  pathPattern: "/b",
  input: { get: () => ({ query: "{}" }) },
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
