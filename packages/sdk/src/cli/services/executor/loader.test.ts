import * as fs from "node:fs";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { loadExecutor } from "./loader";

describe("loadExecutor", () => {
  test("accepts executor trigger helper args", async () => {
    using tmp = tempCwd("sdk-executor-loader-");
    const executorFile = path.join(tmp.dir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: {
    kind: "function",
    body: async () => {},
  },
});
`,
    );

    const executor = await loadExecutor(executorFile);

    expect(executor).not.toBeNull();
    expect(executor?.trigger).not.toHaveProperty("__args");
  });

  test("loads a DocumentNode query as a GraphQL string", async () => {
    using tmp = tempCwd("sdk-executor-loader-");
    const executorFile = path.join(tmp.dir, "executor.ts");
    fs.writeFileSync(
      executorFile,
      `
import { createExecutor, scheduleTrigger } from "@tailor-platform/sdk";

export default createExecutor({
  name: "daily",
  trigger: scheduleTrigger({ cron: "0 12 * * *" }),
  operation: {
    kind: "graphql",
    query: {
      kind: "Document",
      definitions: [
        {
          kind: "OperationDefinition",
          operation: "query",
          name: { kind: "Name", value: "Users" },
          selectionSet: {
            kind: "SelectionSet",
            selections: [{ kind: "Field", name: { kind: "Name", value: "users" } }],
          },
        },
      ],
    },
  },
});
`,
    );

    const executor = await loadExecutor(executorFile);

    expect(executor?.operation).toMatchObject({
      kind: "graphql",
      query: "query Users {\n  users\n}",
    });
  });
});
