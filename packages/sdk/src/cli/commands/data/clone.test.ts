import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { cloneCommand } from "./clone";

const client = {
  cloneApplicationData: vi.fn(),
  getCloneApplicationDataOperation: vi.fn(),
};

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
}));
vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("#/cli/shared/client", () => ({
  initOperatorClient: vi.fn().mockImplementation(async () => client),
}));
vi.mock("#/cli/shared/prompt", () => ({
  prompt: { confirm: vi.fn().mockResolvedValue(true) },
}));

const baseArgs = ["--from", "src", "--to", "dst", "--name", "my-app", "--yes"];

describe("data clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    client.cloneApplicationData.mockResolvedValue({ operationId: "op-1" });
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.COMPLETED,
      errorMessage: "",
    });
  });

  test("コピー元とコピー先に同じアプリ名を渡して clone を開始する", async () => {
    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).toBe(0);
    expect(client.cloneApplicationData).toHaveBeenCalledWith({
      sourceWorkspaceId: "src",
      sourceApplicationName: "my-app",
      targetWorkspaceId: "dst",
      targetApplicationName: "my-app",
      copyFiles: false,
      copyIdpUsers: false,
    });
  });

  test("--copy-files と --copy-idp-users を proto のフィールドに渡す", async () => {
    await runCommand(cloneCommand, [...baseArgs, "--copy-files", "--copy-idp-users"]);

    expect(client.cloneApplicationData).toHaveBeenCalledWith(
      expect.objectContaining({ copyFiles: true, copyIdpUsers: true }),
    );
  });

  test("operation が FAILED になったらエラーメッセージ付きで失敗する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.FAILED,
      errorMessage: "disk full",
    });

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).not.toBe(0);
    expect(String(result.error?.message ?? result.error)).toContain("disk full");
    expect(result.error).toMatchObject({ code: "DATA_CLONE_FAILED" });
  });

  test("operation が想定外の status を返したら待ち続けずに失敗する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.UNSPECIFIED,
      errorMessage: "",
    });

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).not.toBe(0);
    expect(client.getCloneApplicationDataOperation).toHaveBeenCalledTimes(1);
  });

  test("--timeout を超えたら DATA_CLONE_TIMEOUT で失敗する", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.PROCESSING,
      errorMessage: "",
    });

    const result = await runCommand(cloneCommand, [...baseArgs, "--timeout", "1ms"]);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_TIMEOUT" });
  });

  test("--timeout に不正な形式を渡すと API を呼ばずに失敗する", async () => {
    const result = await runCommand(cloneCommand, [...baseArgs, "--timeout", "soon"]);

    expect(result.exitCode).not.toBe(0);
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });

  test("operation ID が空なら状態の確認に進まず失敗する", async () => {
    client.cloneApplicationData.mockResolvedValue({ operationId: "" });

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).not.toBe(0);
    expect(client.getCloneApplicationDataOperation).not.toHaveBeenCalled();
  });

  test("プラットフォームが clone に未対応なら DATA_CLONE_UNAVAILABLE で失敗する", async () => {
    client.cloneApplicationData.mockRejectedValue(new ConnectError("nope", Code.Unimplemented));

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_UNAVAILABLE" });
  });

  test("コピー元とコピー先が同じ workspace なら API を呼ばずに失敗する", async () => {
    const result = await runCommand(cloneCommand, [
      "--from",
      "same",
      "--to",
      "same",
      "--name",
      "my-app",
      "--yes",
    ]);

    expect(result.exitCode).not.toBe(0);
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });
});
