import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { loadAccessToken } from "#/cli/shared/context";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { dismissCommand } from "./dismiss";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
}));

const ID = "0d2c0f1e-5c2b-4e3a-9c1d-2f6a7b8c9d0e";

function mockClient(dismissMyNotification = vi.fn().mockResolvedValue({})) {
  vi.mocked(initOperatorClient).mockResolvedValue({
    dismissMyNotification,
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  return dismissMyNotification;
}

describe("notification dismiss", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    vi.mocked(loadAccessToken).mockResolvedValue("scoped-token");
    await runTest();
    vi.unstubAllEnvs();
  });

  test("dismisses the notification and reports success", async () => {
    const dismiss = mockClient();
    const stderr: string[] = [];
    using _stderr = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
      stderr.push(String(chunk));
      return true;
    });

    const result = await runCommand(dismissCommand, [ID]);

    expect(result.success).toBe(true);
    expect(dismiss).toHaveBeenCalledExactlyOnceWith({ notificationId: ID });
    expect(stderr.join("")).toContain(ID);
  });

  test("prints a mutation result in JSON mode", async () => {
    mockClient();
    using _json = jsonMode();
    using logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runCommand(dismissCommand, [ID]);

    expect(result.success).toBe(true);
    expect(JSON.parse(logSpy.mock.calls[0]?.[0] as string)).toEqual({ changed: true, id: ID });
  });

  test("reports NOTIFICATION_NOT_FOUND when the platform answers NotFound", async () => {
    mockClient(vi.fn().mockRejectedValue(new ConnectError("gone", Code.NotFound)));
    using _json = jsonMode();

    const result = await runCommand(dismissCommand, [ID]);

    expect(result.success).toBe(false);
    expect(result.error).toMatchObject({ code: "NOTIFICATION_NOT_FOUND" });
  });

  test("rejects an id that is not a UUID", async () => {
    mockClient();
    using _json = jsonMode();

    const result = await runCommand(dismissCommand, ["nope"]);

    expect(result.success).toBe(false);
  });
});
