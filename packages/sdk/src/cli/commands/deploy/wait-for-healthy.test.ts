import { Code, ConnectError } from "@connectrpc/connect";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { getAppHealthWith } from "@/cli/commands/workspace/app/health";
import { captureHealthSnapshot, waitForHealthy } from "./wait-for-healthy";
import type { AppHealthInfo } from "@/cli/commands/workspace/app/transform";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("@/cli/commands/workspace/app/health", () => ({
  getAppHealthWith: vi.fn(),
}));

const getAppHealthWithMock = vi.mocked(getAppHealthWith);

beforeEach(() => {
  getAppHealthWithMock.mockReset();
});

describe("waitForHealthy", () => {
  const baseHealth = (overrides: Partial<AppHealthInfo>): AppHealthInfo => ({
    name: "app",
    status: "unknown",
    currentServingSchemaUpdatedAt: null,
    lastAttemptStatus: "N/A",
    lastAttemptAt: null,
    lastAttemptError: "",
    ...overrides,
  });

  const callWaitForHealthy = (overrides: Partial<Parameters<typeof waitForHealthy>[0]>) =>
    waitForHealthy({
      client: {} as OperatorClient,
      workspaceId: "ws-1",
      applicationName: "app",
      previous: null,
      timeoutMs: 1_000,
      pollIntervalMs: 1,
      ...overrides,
    });

  test("resolves when the first poll is a new healthy attempt", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({ lastAttemptStatus: "success", lastAttemptAt: t1 }),
    );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ lastAttemptStatus: "success", lastAttemptAt: t0 }),
      }),
    ).resolves.toBeUndefined();
    expect(getAppHealthWithMock).toHaveBeenCalledTimes(1);
  });

  test("keeps polling while the attempt timestamp matches the pre-snapshot", async () => {
    const stale = new Date("2026-01-01T00:00:00Z");
    const fresh = new Date("2026-01-01T00:00:30Z");
    getAppHealthWithMock
      .mockResolvedValueOnce(baseHealth({ lastAttemptStatus: "success", lastAttemptAt: stale }))
      .mockResolvedValueOnce(baseHealth({ lastAttemptStatus: "success", lastAttemptAt: stale }))
      .mockResolvedValueOnce(baseHealth({ lastAttemptStatus: "success", lastAttemptAt: fresh }));

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ lastAttemptStatus: "success", lastAttemptAt: stale }),
      }),
    ).resolves.toBeUndefined();
    expect(getAppHealthWithMock).toHaveBeenCalledTimes(3);
  });

  test("throws when composition_error is observed on a new attempt", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({
        lastAttemptStatus: "failure",
        lastAttemptAt: t1,
        lastAttemptError: "type 'Foo' is not defined",
      }),
    );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ lastAttemptStatus: "success", lastAttemptAt: t0 }),
      }),
    ).rejects.toThrow(/type 'Foo' is not defined/);
  });

  test("throws on timeout when the attempt never becomes new", async () => {
    const stale = new Date("2026-01-01T00:00:00Z");
    getAppHealthWithMock.mockResolvedValue(
      baseHealth({ lastAttemptStatus: "success", lastAttemptAt: stale }),
    );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ lastAttemptStatus: "success", lastAttemptAt: stale }),
        timeoutMs: 0,
      }),
    ).rejects.toThrow(/Timed out waiting.*tailor-sdk workspace app health/);
  });

  test("accepts any observed attempt when there was no pre-snapshot (initial deploy)", async () => {
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({ lastAttemptStatus: "success", lastAttemptAt: t1 }),
    );

    await expect(callWaitForHealthy({ previous: null })).resolves.toBeUndefined();
    expect(getAppHealthWithMock).toHaveBeenCalledTimes(1);
  });
});

describe("captureHealthSnapshot", () => {
  const params = {
    client: {} as OperatorClient,
    workspaceId: "ws-1",
    name: "app",
  };

  test("returns the health info on success", async () => {
    const snap = { name: "app" } as AppHealthInfo;
    getAppHealthWithMock.mockResolvedValueOnce(snap);

    await expect(captureHealthSnapshot(params)).resolves.toBe(snap);
  });

  test("returns null when the application does not exist (NotFound)", async () => {
    getAppHealthWithMock.mockRejectedValueOnce(new ConnectError("not found", Code.NotFound));

    await expect(captureHealthSnapshot(params)).resolves.toBeNull();
  });

  test("propagates non-NotFound errors", async () => {
    getAppHealthWithMock.mockRejectedValueOnce(new ConnectError("internal error", Code.Internal));

    await expect(captureHealthSnapshot(params)).rejects.toThrow(/internal error/);
  });
});
