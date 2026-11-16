import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, test } from "vitest";

const packageRoot = path.resolve(import.meta.dirname, "..");
const oxlintBin = path.join(packageRoot, "node_modules/.bin/oxlint");
const pluginPath = path.join(packageRoot, "oxlint-plugins/index.js");

const fixture = [
  'import { vi } from "vitest";',
  'import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";',
  'import { mockOperatorClient } from "#/cli/shared/test-helpers/operator-client";',
  "export const typed = mockOperatorClient({ getTenantConfig: {} });",
  "export const cast = {} as unknown as OperatorClient;",
  "export const awaited = {} as unknown as Awaited<ReturnType<typeof initOperatorClient>>;",
  "export const chained = mockOperatorClient({ getTenantConfig: vi.fn().mockResolvedValue({}) });",
  "export const wrapped = mockOperatorClient({ getTenantConfig: vi.fn(async () => ({})) });",
  "export const unrelated = {} as unknown as string;",
  "export const spy = vi.fn().mockResolvedValue({});",
  "",
].join("\n");

type Diagnostic = { code: string; labels: { span: { line: number } }[] };

function lint(level: "error" | "off"): { rule: string; line: number }[] {
  const dir = mkdtempSync(path.join(tmpdir(), "typed-operator-client-mock-"));
  try {
    const config = path.join(dir, ".oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        plugins: [],
        jsPlugins: [pluginPath],
        rules: { "local/typed-operator-client-mock": level },
      }),
    );
    const file = path.join(dir, "client.test.ts");
    writeFileSync(file, fixture);
    const result = spawnSync(oxlintBin, ["--config", config, "-f", "json", file], {
      encoding: "utf8",
    });
    expect(result.error).toBeUndefined();
    expect(result.stderr).toBe("");
    const { diagnostics } = JSON.parse(result.stdout) as { diagnostics: Diagnostic[] };
    return diagnostics.map((diagnostic) => ({
      rule: diagnostic.code,
      line: diagnostic.labels[0]?.span.line ?? 0,
    }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("local/typed-operator-client-mock", () => {
  test("flags operator client casts and spies passed to mockOperatorClient", () => {
    expect(lint("error")).toEqual([
      { rule: "local(typed-operator-client-mock)", line: 5 },
      { rule: "local(typed-operator-client-mock)", line: 6 },
      { rule: "local(typed-operator-client-mock)", line: 7 },
      { rule: "local(typed-operator-client-mock)", line: 8 },
    ]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
