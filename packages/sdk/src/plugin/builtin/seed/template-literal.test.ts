import { describe, expect, test } from "vitest";
import { escapeSeedScriptCodeForTemplateLiteral } from "./template-literal";

async function evaluateTemplateLiteralContent(content: string): Promise<string> {
  const source = `export default \`${content}\`;`;
  const url = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const mod = (await import(/* @vite-ignore */ url)) as { default: string };
  return mod.default;
}

describe("escapeSeedScriptCodeForTemplateLiteral", () => {
  test("round-trips backslashes, backticks, and dollar signs", async () => {
    const scriptCode = [
      String.raw`const path = "C:\seed\users.jsonl";`,
      "const label = `cost is ${amount} and literal $ value`;",
    ].join("\n");

    await expect(
      evaluateTemplateLiteralContent(escapeSeedScriptCodeForTemplateLiteral(scriptCode)),
    ).resolves.toBe(scriptCode);
  });
});
