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

  test("starts the clone with the same application name for the source and the target", async () => {
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

  test("uses the application name from the config for the source and the target when --name is omitted", async () => {
    const result = await runCommand(cloneCommand, ["--from", "src", "--to", "dst", "--yes"]);

    expect(result.exitCode).toBe(0);
    expect(client.cloneApplicationData).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceApplicationName: "config-app",
        targetApplicationName: "config-app",
      }),
    );
  });

  test("does not load the config when --name is given", async () => {
    await runCommand(cloneCommand, baseArgs);

    expect(configLoader.loadConfig).not.toHaveBeenCalled();
  });

  test("fails without calling the API when --name is omitted and the config cannot be loaded", async () => {
    configLoader.loadConfig.mockRejectedValue(new Error("Configuration file not found"));

    const result = await runCommand(cloneCommand, ["--from", "src", "--to", "dst", "--yes"]);

    expect(result.exitCode).not.toBe(0);
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });

  test("puts status: completed in the output once the wait finishes", async () => {
    using _json = jsonMode();
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    await runCommand(cloneCommand, baseArgs);

    expect(out).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-1", status: "completed" }),
    );
  });

  test("puts status: started in the output with --no-wait", async () => {
    using _json = jsonMode();
    const out = vi.spyOn(logger, "out").mockImplementation(() => {});

    await runCommand(cloneCommand, [...baseArgs, "--no-wait"]);

    expect(out).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: "op-1", status: "started" }),
    );
  });

  test("fails without starting the clone and points to tailor deploy when the target has no application", async () => {
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

  test("describes the deploy step in words instead of an executable command when --name is given", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_TARGET_APPLICATION_NOT_FOUND" });
    expect((result.error as { next?: unknown }).next).toBeUndefined();
    expect((result.error as { suggestion?: string }).suggestion).toContain("my-app");
  });

  test("also suggests checking access when the target application is not found", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(cloneCommand, baseArgs);

    expect((result.error as { suggestion?: string }).suggestion).toContain("access");
  });

  test("returns the error as is when checking the target application fails with anything but NotFound", async () => {
    client.getApplication.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).not.toMatchObject({ code: "DATA_CLONE_TARGET_APPLICATION_NOT_FOUND" });
    expect(client.cloneApplicationData).not.toHaveBeenCalled();
  });

  test("keeps the server message and explains the clone conditions and remedies on FailedPrecondition", async () => {
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

  test("says that truncate only empties TailorDB records when the target is not empty", async () => {
    client.cloneApplicationData.mockRejectedValue(
      new ConnectError("target is not empty", Code.FailedPrecondition),
    );

    const result = await runCommand(cloneCommand, [...baseArgs, "--copy-idp-users"]);

    const suggestion = (result.error as { suggestion?: string }).suggestion;
    expect(suggestion).toContain("IdP users");
    expect(suggestion).toContain("separately");
  });

  test("suggests an executable truncate with the config only when --name is omitted", async () => {
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

  test("carries the given config into the deploy suggestion when the target has no application", async () => {
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

  test("suggests checking --from, --to and --name on NotFound", async () => {
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

  test("passes --copy-files and --copy-idp-users to the request fields", async () => {
    await runCommand(cloneCommand, [...baseArgs, "--copy-files", "--copy-idp-users"]);

    expect(client.cloneApplicationData).toHaveBeenCalledWith(
      expect.objectContaining({ copyFiles: true, copyIdpUsers: true }),
    );
  });

  test("fails with the error message when the operation FAILED", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.FAILED,
      errorMessage: "disk full",
    });

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).not.toBe(0);
    expect(String(result.error?.message ?? result.error)).toContain("disk full");
    expect(result.error).toMatchObject({ code: "DATA_CLONE_FAILED" });
  });

  test("fails instead of waiting on an unexpected operation status", async () => {
    client.getCloneApplicationDataOperation.mockResolvedValue({
      status: CloneOperationStatus.UNSPECIFIED,
      errorMessage: "",
    });

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).not.toBe(0);
    expect(client.getCloneApplicationDataOperation).toHaveBeenCalledTimes(1);
  });

  test("sends status checks without a request timeout", async () => {
    await runCommand(cloneCommand, baseArgs);

    const [, callOptions] = client.getCloneApplicationDataOperation.mock.calls[0] as [
      unknown,
      { timeoutMs: number } | undefined,
    ];
    expect(callOptions).toBeUndefined();
  });

  test("only starts the clone and exits without checking the status with --no-wait", async () => {
    const result = await runCommand(cloneCommand, [...baseArgs, "--no-wait"]);

    expect(result.exitCode).toBe(0);
    expect(client.cloneApplicationData).toHaveBeenCalledOnce();
    expect(client.getCloneApplicationDataOperation).not.toHaveBeenCalled();
  });

  test("fails without checking the status when the operation ID is empty", async () => {
    client.cloneApplicationData.mockResolvedValue({ operationId: "" });

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.exitCode).not.toBe(0);
    expect(client.getCloneApplicationDataOperation).not.toHaveBeenCalled();
  });

  test("fails with DATA_CLONE_UNAVAILABLE when the platform does not support clone", async () => {
    client.cloneApplicationData.mockRejectedValue(new ConnectError("nope", Code.Unimplemented));

    const result = await runCommand(cloneCommand, baseArgs);

    expect(result.error).toMatchObject({ code: "DATA_CLONE_UNAVAILABLE" });
  });

  test("fails without calling the API when the source and target workspaces are the same", async () => {
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
