import { describe, expect, test } from "vitest";
import { lintWithLocalRule } from "./test-helpers/local-rule";

const fixture = [
  'import { vi } from "vitest";',
  'vi.mock("#/cli/shared/logger", () => ({ logger: {} }));',
  'vi.mock(import("#/cli/shared/logger"), () => ({ logger: {} }));',
  'vi.doMock("#/cli/shared/logger", () => ({ logger: {} }));',
  'vi.mock("#/cli/shared/logger", function () { return { logger: {} }; });',
  'vi.mock("../shared/logger.ts", () => ({ logger: {} }));',
  'vi.mock("../shared/logger", () => ({ logger: {} }));',
  'vi.mock("#/cli/shared/logger", async (importOriginal) => ({ ...(await importOriginal()) }));',
  'vi.mock("#/cli/shared/logger", async function (importOriginal) { return { ...(await importOriginal()) }; });',
  'vi.mock("#/cli/shared/logger");',
  'vi.mock("#/cli/shared/logger", { spy: true });',
  'vi.mock("#/cli/shared/client", () => ({}));',
  'vi.mock("#/runtime/logger", () => ({}));',
  'vi.mock("./logger", () => ({}));',
  'vi.mock("node:fs", () => ({}));',
  "",
].join("\n");

const sibling = ['import { vi } from "vitest";', 'vi.mock("./logger", () => ({}));', ""].join("\n");

function lint(level: "error" | "off", source: string, fileName: string) {
  return lintWithLocalRule({ rule: "logger-mock-import-original", level, fileName, source });
}

describe("local/logger-mock-import-original", () => {
  test("flags logger mock factories that do not take importOriginal", () => {
    expect(lint("error", fixture, "src/cli/commands/command.test.ts")).toEqual(
      [2, 3, 4, 5, 6, 7].map((line) => ({ rule: "local(logger-mock-import-original)", line })),
    );
  });

  test("resolves a relative specifier against the linted file", () => {
    expect(lint("error", sibling, "src/cli/shared/store.test.ts")).toEqual([
      { rule: "local(logger-mock-import-original)", line: 2 },
    ]);
  });

  test("reports nothing when disabled, so the fixtures themselves are clean", () => {
    expect(lint("off", fixture, "src/cli/commands/command.test.ts")).toEqual([]);
    expect(lint("off", sibling, "src/cli/shared/store.test.ts")).toEqual([]);
  });
});
