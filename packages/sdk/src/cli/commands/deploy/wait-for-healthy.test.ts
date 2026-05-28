import { beforeEach, describe, expect, test, vi } from "vitest";
import { waitForHealthy } from "./wait-for-healthy";
import type { AppHealthInfo } from "@/cli/commands/workspace/app/transform";
import type { OperatorClient } from "@/cli/shared/client";

vi.mock("@/cli/commands/workspace/app/health", () => ({
  getAppHealthWith: vi.fn(),
}));

const { getAppHealthWith } = await import("@/cli/commands/workspace/app/health");
const getAppHealthWithMock = vi.mocked(getAppHealthWith);

const fakeClient = {} as OperatorClient;

const baseHealth = (overrides: Partial<AppHealthInfo>): AppHealthInfo => ({
  name: "app",
  status: "unknown",
  currentServingSchemaUpdatedAt: null,
  lastAttemptStatus: "N/A",
  lastAttemptAt: null,
  lastAttemptError: "",
  ...overrides,
});

const callWaitForHealthy = (overrides: Partial<Parameters<typeof waitForHealthy>[0]> = {}) =>
  waitForHealthy({
    client: fakeClient,
    workspaceId: "ws-1",
    applicationName: "app",
    previous: null,
    timeoutMs: 1_000,
    pollIntervalMs: 1,
    initialDelayMs: 0,
    ...overrides,
  });

beforeEach(() => {
  getAppHealthWithMock.mockReset();
});

describe("waitForHealthy", () => {
  test("resolves when the first poll is a new healthy attempt", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: t1 }),
    );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: t0 }),
      }),
    ).resolves.toBeUndefined();
    expect(getAppHealthWithMock).toHaveBeenCalledTimes(1);
  });

  test("keeps polling while the attempt timestamp matches the pre-snapshot", async () => {
    const stale = new Date("2026-01-01T00:00:00Z");
    const fresh = new Date("2026-01-01T00:00:30Z");
    getAppHealthWithMock
      .mockResolvedValueOnce(
        baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: stale }),
      )
      .mockResolvedValueOnce(
        baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: stale }),
      )
      .mockResolvedValueOnce(
        baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: fresh }),
      );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: stale }),
      }),
    ).resolves.toBeUndefined();
    expect(getAppHealthWithMock).toHaveBeenCalledTimes(3);
  });

  test("throws when composition_error is observed on a new attempt", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({
        status: "composition_error",
        lastAttemptStatus: "failure",
        lastAttemptAt: t1,
        lastAttemptError: "type 'Foo' is not defined",
      }),
    );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: t0 }),
      }),
    ).rejects.toThrow(/type 'Foo' is not defined/);
  });

  test("throws on timeout when the attempt never becomes new", async () => {
    const stale = new Date("2026-01-01T00:00:00Z");
    getAppHealthWithMock.mockResolvedValue(
      baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: stale }),
    );

    let calls = 0;
    const now = () => {
      calls += 1;
      // First call captures deadline at t=0 → deadline=5000.
      // Subsequent calls report t=6000 so the first deadline check trips.
      return calls === 1 ? 0 : 6_000;
    };

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: stale }),
        timeoutMs: 5_000,
        pollIntervalMs: 1,
        now,
      }),
    ).rejects.toThrow(/Timed out waiting/);
  });

  test("accepts any observed attempt when there was no pre-snapshot (initial deploy)", async () => {
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: t1 }),
    );

    await expect(callWaitForHealthy({ previous: null })).resolves.toBeUndefined();
    expect(getAppHealthWithMock).toHaveBeenCalledTimes(1);
  });

  test("error message references the correct CLI binary name", async () => {
    const t0 = new Date("2026-01-01T00:00:00Z");
    const t1 = new Date("2026-01-01T00:00:10Z");
    getAppHealthWithMock.mockResolvedValueOnce(
      baseHealth({
        status: "composition_error",
        lastAttemptStatus: "failure",
        lastAttemptAt: t1,
        lastAttemptError: "boom",
      }),
    );

    await expect(
      callWaitForHealthy({
        previous: baseHealth({ status: "ok", lastAttemptStatus: "success", lastAttemptAt: t0 }),
      }),
    ).rejects.toThrow(/tailor-sdk workspace app health/);
  });
});
