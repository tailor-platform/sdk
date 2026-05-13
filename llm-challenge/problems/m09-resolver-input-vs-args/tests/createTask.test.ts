import path from "node:path";
import { describe, expect, test } from "vitest";
import { createWorkDirContext, importPath } from "../../../shared/test-helpers.js";

const { workDir, workDirReady } = createWorkDirContext(import.meta.dirname);

describe.skipIf(!workDirReady)("m09-resolver-input-vs-args", () => {
  test("resolver is default exported and named 'createTask' as a mutation", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createTask.ts"));
    const resolver = mod.default;
    expect(resolver).toBeDefined();
    expect(resolver.name).toBe("createTask");
    expect(resolver.operation).toBe("mutation");
  });

  test("input declares a string title field", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createTask.ts"));
    const resolver = mod.default;
    expect(resolver.input).toBeDefined();
    expect(resolver.input.title).toBeDefined();
    expect(resolver.input.title.type).toBe("string");
  });

  test("body echoes the supplied title alongside id 'task-1'", async () => {
    const mod = await importPath(path.join(workDir, "resolvers/createTask.ts"));
    const result = await mod.default.body({
      input: { title: "Buy milk" },
      user: {},
      env: {},
    });
    expect(result).toEqual({ id: "task-1", title: "Buy milk" });
  });
});
