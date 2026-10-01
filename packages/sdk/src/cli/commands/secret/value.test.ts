import { Readable } from "node:stream";
import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { loadOperatorWorkspaceContext } from "#/cli/shared/operator-context";
import { createSecretCommand } from "./create";
import { updateSecretCommand } from "./update";
import { resolveSecretValue } from "./value";
import type * as LoggerModule from "#/cli/shared/logger";

vi.mock("#/cli/shared/operator-context", () => ({
  loadOperatorWorkspaceContext: vi.fn(),
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

vi.mock("./check-vault-managed", () => ({
  checkVaultManaged: vi.fn().mockResolvedValue({ isManaged: false }),
  releaseVaultOwnership: vi.fn(),
}));

vi.mock("#/cli/shared/logger", async (importOriginal) => {
  const original = await importOriginal<typeof LoggerModule>();
  return {
    ...original,
    logger: Object.assign(Object.create(original.logger), {
      registerSecret: vi.fn(),
      success: vi.fn(),
    }),
  };
});

function input(chunks: (string | Buffer)[], isTTY?: boolean): Readable & { isTTY?: boolean } {
  return Object.assign(Readable.from(chunks), { isTTY });
}

describe("resolveSecretValue", () => {
  test("returns --value without reading standard input", async () => {
    const stdin = input(["unused"]);

    await expect(
      resolveSecretValue({ value: "sk_live", "value-stdin": false }, stdin, "secret create"),
    ).resolves.toBe("sk_live");
    expect(stdin.readableEnded).toBe(false);
  });

  test.each([
    { name: "a trailing LF", chunks: ["sk_live\n"], expected: "sk_live" },
    { name: "a trailing CRLF", chunks: ["sk_live\r\n"], expected: "sk_live" },
    { name: "only one trailing newline", chunks: ["sk_live\n\n"], expected: "sk_live\n" },
    { name: "no trailing newline", chunks: ["sk_live"], expected: "sk_live" },
    {
      name: "a character split across chunks",
      chunks: [Buffer.from([0xe3, 0x81]), Buffer.from([0x82, 0x0a])],
      expected: "あ",
    },
    { name: "inner newlines", chunks: ["line1\nline2\n"], expected: "line1\nline2" },
  ])("reads standard input with $name", async ({ chunks, expected }) => {
    await expect(
      resolveSecretValue({ "value-stdin": true }, input(chunks), "secret create"),
    ).resolves.toBe(expected);
  });

  test("rejects --value together with --value-stdin", async () => {
    await expect(
      resolveSecretValue({ value: "x", "value-stdin": true }, input(["y"]), "secret update"),
    ).rejects.toMatchObject({ code: "SECRET_VALUE_OPTIONS_CONFLICT", command: "secret update" });
  });

  test("requires --value or --value-stdin", async () => {
    await expect(
      resolveSecretValue({ "value-stdin": false }, input([]), "secret create"),
    ).rejects.toMatchObject({ code: "SECRET_VALUE_REQUIRED", command: "secret create" });
  });

  test("refuses to wait for a value typed into a terminal", async () => {
    await expect(
      resolveSecretValue({ "value-stdin": true }, input(["x"], true), "secret create"),
    ).rejects.toMatchObject({ code: "SECRET_VALUE_STDIN_TTY" });
  });

  test.each([
    { name: "nothing", chunks: [] },
    { name: "only a newline", chunks: ["\n"] },
  ])("rejects standard input that contains $name", async ({ chunks }) => {
    await expect(
      resolveSecretValue({ "value-stdin": true }, input(chunks), "secret create"),
    ).rejects.toMatchObject({ code: "SECRET_VALUE_EMPTY" });
  });

  test("rejects standard input that is not valid UTF-8", async () => {
    await expect(
      resolveSecretValue(
        { "value-stdin": true },
        input([Buffer.from([0x73, 0x6b, 0xff])]),
        "secret create",
      ),
    ).rejects.toMatchObject({ code: "SECRET_VALUE_INVALID_UTF8" });
  });
});

function stubClient() {
  const client = {
    createSecretManagerSecret: vi.fn().mockResolvedValue({}),
    updateSecretManagerSecret: vi.fn().mockResolvedValue({}),
  };
  vi.mocked(loadOperatorWorkspaceContext).mockResolvedValue({
    client,
    workspaceId: "workspace-1",
  } as unknown as Awaited<ReturnType<typeof loadOperatorWorkspaceContext>>);
  return client;
}

describe.each([
  { name: "create", command: createSecretCommand, rpc: "createSecretManagerSecret" },
  { name: "update", command: updateSecretCommand, rpc: "updateSecretManagerSecret" },
] as const)("secret $name", ({ command, rpc }) => {
  aroundEach(async (runTest) => {
    await runTest();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  test("sends the value piped to standard input with --value-stdin", async () => {
    const client = stubClient();
    vi.spyOn(process, "stdin", "get").mockReturnValue(
      input(["sk_live_piped\n"]) as unknown as typeof process.stdin,
    );

    const result = await runCommand(command, [
      "--vault-name",
      "api-keys",
      "--name",
      "stripe",
      "--value-stdin",
    ]);

    expect(result.success).toBe(true);
    expect(logger.registerSecret).toHaveBeenCalledWith("sk_live_piped");
    expect(client[rpc]).toHaveBeenCalledWith({
      workspaceId: "workspace-1",
      secretmanagerVaultName: "api-keys",
      secretmanagerSecretName: "stripe",
      secretmanagerSecretValue: "sk_live_piped",
    });
  });

  test("rejects a missing value before contacting the platform", async () => {
    stubClient();

    const result = await runCommand(command, ["--vault-name", "api-keys", "--name", "stripe"]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "SECRET_VALUE_REQUIRED" });
    expect(loadOperatorWorkspaceContext).not.toHaveBeenCalled();
  });
});
