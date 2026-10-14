import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { describe, test, expect, vi, beforeEach } from "vitest";
import { logger } from "#/cli/shared/logger";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { cloneCommand } from "./clone";

const configLoader = vi.hoisted(() => ({ loadConfig: vi.fn() }));

const client = {
  getApplication: vi.fn(),
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
vi.mock("#/cli/shared/config-loader", () => configLoader);
vi.mock("#/cli/shared/prompt", () => ({
  prompt: { confirm: vi.fn().mockResolvedValue(true) },
}));

const baseArgs = ["--from", "src", "--to", "dst", "--name", "my-app", "--yes"];

describe("data clone", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    configLoader.loadConfig.mockResolvedValue({ config: { name: "config-app" } });
    client.getApplication.mockResolvedValue({});
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

  test("--name を省略したら、設定ファイルのアプリ名をコピー元とコピー先に使う", async () => {
    const result = await runCommand(cloneCommand, ["--from", "src", "--to", "dst", "--yes"]);

    expect(result.exitCode).toBe(0);
    expect(client.cloneApplicationData).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceApplicationName: "config-app",
        targetApplicationName: "config-app",
      }),
    );
  });

  test("--name を指定したら、設定ファイルを読まない", async () => {
    await runCommand(cloneCommand, baseArgs);

    expect(configLoader.loadConfig).not.toHaveBeenCalled();
  });

  test("--name を省略して設定ファイルも読めないなら、API を呼ばずに失敗する", async () => {
    configLoader.loadConfig.mockRejectedValue(new Error("Configuration file not found"));

    const result = await runCommand(cloneCommand, ["--from", "src", "--to", "dst", "--yes"]);

    expect(result.exitCode).not.toBe(0);
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });

  test("待って完了したら、標準出力の結果に status: completed を入れる", async () => {
    using _json = jsonMode();
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    await runCommand(cloneCommand, baseArgs);

    expect(out).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-1", status: "completed" }),
    );
  });

  test("--no-wait なら、標準出力の結果の status は started になる", async () => {
    using _json = jsonMode();
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    await runCommand(cloneCommand, [...baseArgs, "--no-wait"]);

    expect(out).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-1", status: "started" }),
    );
  });

  test("コピー先にアプリがなければ、clone を始めずに、先に deploy するよう案内して失敗する", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(cloneCommand, ["--from", "src", "--to", "dst", "--yes"]);

    expect(result.error).toMatchObject({
      code: "DATA_CLONE_TARGET_APPLICATION_NOT_FOUND",
      next: { command: "tailor", args: ["deploy", "--workspace-id=dst"] },
    });
    expect(client.getApplication).toHaveBeenCalledWith({
      workspaceId: "dst",
      applicationName: "config-app",
    });
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });

  test("--name を指定したときは、deploy を実行できる形では案内せず文章で案内する", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_TARGET_APPLICATION_NOT_FOUND" });
    expect((result.error as { next?: unknown }).next).toBeUndefined();
    expect((result.error as { suggestion?: string }).suggestion).toContain("my-app");
  });

  test("コピー先アプリの確認が NotFound 以外で失敗したら、そのエラーをそのまま返す", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).not.toMatchObject({ code: "DATA_CLONE_TARGET_APPLICATION_NOT_FOUND" });
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });

  test("サーバーが FailedPrecondition を返したら、メッセージを残して clone できる条件と対処を案内する", async () => {
    client.cloneApplicationData.mockRejectedValue(
      new ConnectError(
        'target namespace "testdb" already contains data in tables: User',
        Code.FailedPrecondition,
      ),
    );

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).toMatchObject({
      code: "DATA_CLONE_PRECONDITION_FAILED",
      message: 'target namespace "testdb" already contains data in tables: User',
    });
    const suggestion = (result.error as { suggestion?: string }).suggestion;
    expect(suggestion).toContain("tailordb truncate");
    expect(suggestion).not.toContain("--all");
  });

  test("--name を省略したときだけ、設定ファイルを指定した実行可能な truncate を案内する", async () => {
    client.cloneApplicationData.mockRejectedValue(
      new ConnectError("target is not empty", Code.FailedPrecondition),
    );

    const result = await runCommand(cloneCommand, [
      "--from",
      "src",
      "--to",
      "dst",
      "--yes",
      "--config",
      "custom.ts",
    ]);

    const suggestion = (result.error as { suggestion?: string }).suggestion;
    expect(suggestion).toContain("tailordb truncate --all");
    expect(suggestion).toContain("--config=custom.ts");
  });

  test("コピー先にアプリがなければ、deploy の案内に指定した設定ファイルを引き継ぐ", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(cloneCommand, [
      "--from",
      "src",
      "--to",
      "dst",
      "--yes",
      "--config",
      "custom.ts",
    ]);

    expect(result.error).toMatchObject({
      next: { command: "tailor", args: ["deploy", "--workspace-id=dst", "--config=custom.ts"] },
    });
  });

  test("サーバーが NotFound を返したら、--from と --to と --name の確認を案内する", async () => {
    client.cloneApplicationData.mockRejectedValue(
      new ConnectError("source application not found", Code.NotFound),
    );

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).toMatchObject({
      code: "DATA_CLONE_NOT_FOUND",
      message: "source application not found",
    });
    expect((result.error as { suggestion?: string }).suggestion).toContain("--from");
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

  test("状態確認に待ち時間の上限を付けない", async () => {
    await runCommand(cloneCommand, baseArgs);

    const [, callOptions] = client.getCloneApplicationDataOperation.mock.calls[0] as [
      unknown,
      { timeoutMs: number } | undefined,
    ];
    expect(callOptions).toBeUndefined();
  });

  test("--no-wait なら、開始だけして状態を確認せずに終了する", async () => {
    const result = await runCommand(cloneCommand, [...baseArgs, "--no-wait"]);

    expect(result.exitCode).toBe(0);
    expect(client.cloneApplicationData).toHaveBeenCalledOnce();
    expect(client.getCloneApplicationDataOperation).not.toHaveBeenCalled();
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
