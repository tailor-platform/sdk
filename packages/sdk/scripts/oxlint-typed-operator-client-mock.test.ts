import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

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
  "export const intersected = {} as unknown as OperatorClient & { extra: true };",
  "export const asserted = <OperatorClient>{};",
  "const getTenantConfig = vi.fn().mockResolvedValue({});",
  "export const shorthand = mockOperatorClient({ getTenantConfig });",
  "export const byName = mockOperatorClient({ getTenantConfig: getTenantConfig });",
  "export const context = {} as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>;",
  "export const pat = {} as unknown as Awaited<ReturnType<typeof createPatOperatorClient>>;",
  'export const indexed = {} as unknown as Target["client"];',
  "vi.mocked(initOperatorClient).mockResolvedValue({} as never);",
  "vi.mocked(loadOperatorWorkspaceContext).mockResolvedValueOnce(cast as any);",
  'export const otherIndex = {} as unknown as Target["name"];',
  "vi.mocked(Math.max).mockReturnValue(1 as never);",
  "",
].join("\n");

const localNamesake = [
  'import { vi } from "vitest";',
  "function mockOperatorClient(overrides: object) {",
  "  return overrides;",
  "}",
  "export const local = mockOperatorClient({ getTenantConfig: vi.fn() });",
  "",
].join("\n");

function lint(level: "error" | "off", source = fixture) {
  return lintWithLocalRule({
    rule: "typed-operator-client-mock",
    level,
    fileName: "client.test.ts",
    source,
  });
}

describe("local/typed-operator-client-mock", () => {
  test("flags operator client casts and spies passed to mockOperatorClient", () => {
    expect(lint("error")).toEqual([
      { rule: "local(typed-operator-client-mock)", line: 5 },
      { rule: "local(typed-operator-client-mock)", line: 6 },
      { rule: "local(typed-operator-client-mock)", line: 7 },
      { rule: "local(typed-operator-client-mock)", line: 8 },
      { rule: "local(typed-operator-client-mock)", line: 11 },
      { rule: "local(typed-operator-client-mock)", line: 12 },
      { rule: "local(typed-operator-client-mock)", line: 14 },
      { rule: "local(typed-operator-client-mock)", line: 15 },
      { rule: "local(typed-operator-client-mock)", line: 16 },
      { rule: "local(typed-operator-client-mock)", line: 17 },
      { rule: "local(typed-operator-client-mock)", line: 18 },
      { rule: "local(typed-operator-client-mock)", line: 19 },
      { rule: "local(typed-operator-client-mock)", line: 20 },
    ]);
  });

  test("leaves spies passed to a local function of the same name alone", () => {
    expect(lint("error", localNamesake)).toEqual([]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
