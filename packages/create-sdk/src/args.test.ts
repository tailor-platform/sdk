import { defineCommand, runCommand } from "@politty/zod";
import { describe, expect, test } from "vitest";
import { args } from "./args";

const parse = async (argv: string[]) => {
  let received: unknown;
  const command = defineCommand({
    name: "create-sdk",
    args,
    run: (parsed) => {
      received = parsed;
    },
  });
  const result = await runCommand(command, argv);
  return { result, received };
};

describe("create-sdk args", () => {
  test.each([
    ["positionally", ["my-app"]],
    ["by option name", ["--name", "my-app"]],
  ])("takes the project name given %s", async (_, argv) => {
    const { result, received } = await parse(argv);

    expect(result.success).toBe(true);
    expect(received).toMatchObject({ name: "my-app" });
  });

  test("takes the template alongside a positional project name", async () => {
    const { received } = await parse(["--template", "hello-world", "my-app"]);

    expect(received).toEqual({ name: "my-app", template: "hello-world" });
  });
});
