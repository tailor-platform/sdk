import { runCommand } from "@politty/zod";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { describe, test, expect, vi, beforeEach } from "vitest";
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

  test("--wait なしでは、状態を 1 回だけ確認して終了する", async () => {
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

  test("--wait なしでは、clone が失敗していても終了コードは 0 で状態を報告する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.FAILED,
      errorMessage: "namespace mismatch",
    });

    const result = await runCommand(getCommand, baseArgs);

    expect(result.exitCode).toBe(0);
  });

  test("--wait なら、完了を確認して成功で終了する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.COMPLETED,
      errorMessage: "",
    });

    const result = await runCommand(getCommand, [...baseArgs, "--wait"]);

    expect(result.exitCode).toBe(0);
  });

  test("--wait で clone が失敗していたら、プラットフォームのメッセージ付きで失敗する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.FAILED,
      errorMessage: "namespace mismatch",
    });

    const result = await runCommand(getCommand, [...baseArgs, "--wait"]);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_FAILED" });
    expect(String(result.error?.message)).toContain("namespace mismatch");
  });

  test("--wait の待ち時間を超えたら、続きを待つコマンドを next に入れて失敗する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.PENDING,
      errorMessage: "",
    });

    const result = await runCommand(getCommand, [...baseArgs, "--wait", "--timeout", "1ms"]);

    expect(result.error).toMatchObject({
      code: "DATA_CLONE_TIMEOUT",
      next: {
        command: "tailor",
        args: expect.arrayContaining(["--operation-id", "op-1", "--wait"]),
      },
    });
  });
});
