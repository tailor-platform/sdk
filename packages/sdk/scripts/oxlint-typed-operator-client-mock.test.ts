import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  'import { vi } from "vitest";',
  'import { initOperatorClient, type OperatorClient } from "#/cli/shared/client";',
  "export const cast = {} as unknown as OperatorClient;",
  "export const awaited = {} as unknown as Awaited<ReturnType<typeof initOperatorClient>>;",
  "export const unrelated = {} as unknown as string;",
  "export const intersected = {} as unknown as OperatorClient & { extra: true };",
  "export const asserted = <OperatorClient>{};",
  "export const context = {} as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>;",
  "export const pat = {} as unknown as Awaited<ReturnType<typeof createPatOperatorClient>>;",
  'export const indexed = {} as unknown as Target["client"];',
  "vi.mocked(initOperatorClient).mockResolvedValue({} as never);",
  "vi.mocked(loadOperatorWorkspaceContext).mockResolvedValueOnce(cast as any);",
  'export const otherIndex = {} as unknown as Target["name"];',
  "vi.mocked(Math.max).mockReturnValue(1 as never);",
  "",
].join("\n");

const imports = [
  'import { vi } from "vitest";',
  'import type { OperatorClient as Client } from "#/cli/shared/client";',
  'import { initOperatorClient as init } from "#/cli/shared/client";',
  'import * as client from "#/cli/shared/client";',
  'import type { Other as OperatorClient } from "./other";',
  "export const aliased = {} as Client;",
  "vi.mocked(init).mockResolvedValue({} as never);",
  "export const qualified = {} as client.OperatorClient;",
  "export const queried = {} as Awaited<ReturnType<typeof client.initOperatorClient>>;",
  "vi.mocked(client.initOperatorClient).mockResolvedValue({} as never);",
  'export const imported = {} as import("#/cli/shared/client").OperatorClient;',
  "export const renamed = {} as OperatorClient;",
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
  test("flags operator client casts", () => {
    expect(lint("error")).toEqual([
      { rule: "local(typed-operator-client-mock)", line: 3 },
      { rule: "local(typed-operator-client-mock)", line: 4 },
      { rule: "local(typed-operator-client-mock)", line: 6 },
      { rule: "local(typed-operator-client-mock)", line: 7 },
      { rule: "local(typed-operator-client-mock)", line: 8 },
      { rule: "local(typed-operator-client-mock)", line: 9 },
      { rule: "local(typed-operator-client-mock)", line: 10 },
      { rule: "local(typed-operator-client-mock)", line: 11 },
      { rule: "local(typed-operator-client-mock)", line: 12 },
    ]);
  });

  test("resolves the client and its loaders through import aliases and namespaces", () => {
    expect(lint("error", imports)).toEqual([
      { rule: "local(typed-operator-client-mock)", line: 6 },
      { rule: "local(typed-operator-client-mock)", line: 7 },
      { rule: "local(typed-operator-client-mock)", line: 8 },
      { rule: "local(typed-operator-client-mock)", line: 9 },
      { rule: "local(typed-operator-client-mock)", line: 10 },
      { rule: "local(typed-operator-client-mock)", line: 11 },
    ]);
  });

  test("reports nothing when disabled, so the fixture itself is clean", () => {
    expect(lint("off")).toEqual([]);
  });
});
