import { runCommand } from "@politty/zod";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { logger } from "#/cli/shared/logger";
import { getCommand } from "./get";

const client = { getCloneApplicationDataOperation: vi.fn() };

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
}));
vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn().mockImplementation(async () => client),
}));

const baseArgs = ["--from", "src", "--to", "dst", "--operation-id", "op-1"];

describe("data operation get", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("checks the status once and exits without --wait", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.PROCESSING,
      errorMessage: "",
    });

    const result = await runCommand(getCommand, baseArgs);

    expect(result.exitCode).toBe(0);
    expect(client.getCloneApplicationDataOperation).toHaveBeenCalledOnce();
    expect(client.getCloneApplicationDataOperation).toHaveBeenCalledWith({
      sourceWorkspaceId: "src",
      targetWorkspaceId: "dst",
      operationId: "op-1",
    });
  });

  test("reports a failed clone with exit code 0 without --wait", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.FAILED,
      errorMessage: "namespace mismatch",
    });

    const result = await runCommand(getCommand, baseArgs);

    expect(result.exitCode).toBe(0);
  });

  test("exits successfully once the clone completes with --wait", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.COMPLETED,
      errorMessage: "",
    });

    const result = await runCommand(getCommand, [...baseArgs, "--wait"]);

    expect(result.exitCode).toBe(0);
  });

  test("reports how long it waited, not how long the clone took, when --wait completes", async () => {
    const success = vi.spyOn(logger, "success").mockImplementation(() => {});
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.COMPLETED,
      errorMessage: "",
    });

    await runCommand(getCommand, [...baseArgs, "--wait"]);

    expect(success).toHaveBeenCalledWith(expect.stringMatching(/completed \(waited \d/));
  });

  test("fails with the platform message when the clone failed with --wait", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.FAILED,
      errorMessage: "namespace mismatch",
    });

    const result = await runCommand(getCommand, [...baseArgs, "--wait"]);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_FAILED" });
    expect(String(result.error?.message)).toContain("namespace mismatch");
  });
});
