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

const methodMocks = [
  'import { vi } from "vitest";',
  'import { mockOperatorClient, withOperatorClientMocks } from "./operator-client";',
  "client.getMetadata.mockResolvedValue({} as never);",
  "client.getMetadata.mockResolvedValueOnce({} as any);",
  "vi.mocked(client.getMetadata).mockReturnValue({} as never);",
  "ctx.operatorClient.getMetadata.mockReturnValueOnce({} as never);",
  "client.getMetadata.mockResolvedValueOnce({}).mockResolvedValueOnce({} as never);",
  "client.getMetadata.mockImplementation(async () => ({}) as never);",
  "client.getMetadata.mockImplementationOnce(async function () { return {} as never; });",
  "client.getMetadata.mockImplementation(async (request: unknown) => ({ request }));",
  "mockOperatorClient({ getMetadata: {} as never });",
  "mockOperatorClient({ getMetadata: async (request: object) => ({ request }) });",
  "withOperatorClientMocks(client, { watchEvents: async function* () { yield {} as never; } });",
  "withOperatorClientMocks(client, { getMetadata() { return {} as any; } });",
  "vi.mocked(initOperatorClient).mockReset().mockResolvedValue({} as never);",
  "client.getMetadata.mockResolvedValue({});",
  "client.getMetadata.mockImplementation(async (request) => ({ request }));",
  "client.getMetadata.mockImplementation(async () => { const read = () => ({}) as never; return read(); });",
  "client.getMetadata.mockRejectedValue(new Error() as never);",
  "service.load.mockResolvedValue({} as never);",
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

  test("flags unchecked responses and annotated requests in operator client method mocks", () => {
    expect(lint("error", methodMocks)).toEqual(
      [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15].map((line) => ({
        rule: "local(typed-operator-client-mock)",
        line,
      })),
    );
  });

  test("reports nothing when disabled, so the fixtures themselves are clean", () => {
    expect(lint("off")).toEqual([]);
    expect(lint("off", imports)).toEqual([]);
    expect(lint("off", methodMocks)).toEqual([]);
  });
});
