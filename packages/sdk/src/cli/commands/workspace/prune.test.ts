import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError } from "@connectrpc/connect";
import { runCommand } from "@politty/zod";
import { aroundEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import {
  loadAccessToken,
  loadPlatformClientConfig,
  readPlatformConfig,
  writePlatformConfig,
} from "#/cli/shared/context";
import { logger } from "#/cli/shared/logger";
import { prompt } from "#/cli/shared/prompt";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { parseAge, pruneCommand, selectPruneCandidates } from "./prune";
import type { RunResult } from "@politty/zod";
import type { Workspace } from "@tailor-platform/tailor-proto/workspace_resource_pb";

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadPlatformClientConfig: vi.fn().mockResolvedValue(undefined),
  readPlatformConfig: vi.fn().mockResolvedValue({ profiles: {} }),
  writePlatformConfig: vi.fn(),
}));

const loggerState = vi.hoisted(() => ({ jsonMode: false }));

vi.mock("#/cli/shared/logger", async (importOriginal) => {
  return {
    ...(await importOriginal()),
    logger: {
      get jsonMode() {
        return loggerState.jsonMode;
      },
      info: vi.fn(),
      success: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      out: vi.fn(),
      newline: vi.fn(),
    },
  };
});

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn(),
  },
}));

vi.mock("#/cli/shared/readonly-guard", () => ({
  assertWritable: vi.fn(),
}));

const NOW = new Date("2026-09-07T12:00:00Z");
const ORG_A = "11111111-1111-4111-8111-111111111111";
const ORG_B = "22222222-2222-4222-8222-222222222222";
const FOLDER_A = "33333333-3333-4333-8333-333333333333";

function hoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 3_600_000);
}

function workspace(
  name: string,
  overrides: Partial<Omit<Workspace, "createTime">> & { createdAt?: Date | null } = {},
): Workspace {
  const { createdAt = hoursAgo(48), ...rest } = overrides;
  return {
    id: `id-${name}`,
    name,
    region: "us-west",
    organizationId: ORG_A,
    folderId: "",
    deleteProtection: false,
    ...(createdAt ? { createTime: timestampFromDate(createdAt) } : {}),
    ...rest,
  } as Workspace;
}

function stubClient(workspaces: Workspace[]) {
  const client = {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces, nextPageToken: "" }),
    getOrganizationFolder: vi.fn().mockResolvedValue({ folder: { name: "dev" } }),
    deleteWorkspace: vi.fn().mockResolvedValue({}),
  };
  vi.mocked(initOperatorClient).mockResolvedValue(
    client as unknown as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  return client;
}

function expectFailure(result: RunResult, message: string): void {
  expect(result.success).toBe(false);
  if (result.success) {
    throw new Error("Expected command to fail");
  }
  expect(result.error.message).toContain(message);
}

describe("parseAge", () => {
  test("converts seconds, minutes, hours, and days to milliseconds", () => {
    expect(parseAge("30s")).toBe(30_000);
    expect(parseAge("5m")).toBe(300_000);
    expect(parseAge("24h")).toBe(86_400_000);
    expect(parseAge("7d")).toBe(604_800_000);
    expect(parseAge("0s")).toBe(0);
  });
});

describe("selectPruneCandidates", () => {
  const baseCriteria = {
    nameRegexes: [/^(?:e2e-ws-.*)$/],
    olderThanMs: parseAge("24h"),
    exclude: new Set<string>(),
  };

  test("keeps only workspaces matching a name pattern and older than the threshold", () => {
    const stale = workspace("e2e-ws-1");
    const fresh = workspace("e2e-ws-2", { createdAt: hoursAgo(1) });
    const unrelated = workspace("production");

    const selection = selectPruneCandidates([stale, fresh, unrelated], baseCriteria, NOW);

    expect(selection.candidates).toEqual([stale]);
    expect(selection.tooYoung).toEqual([fresh]);
  });

  test("treats the threshold as inclusive and a zero age as any age", () => {
    const exact = workspace("e2e-ws-exact", { createdAt: hoursAgo(24) });
    const justNow = workspace("e2e-ws-now", { createdAt: NOW });

    expect(selectPruneCandidates([exact], baseCriteria, NOW).candidates).toEqual([exact]);
    expect(
      selectPruneCandidates([justNow], { ...baseCriteria, olderThanMs: 0 }, NOW).candidates,
    ).toEqual([justNow]);
  });

  test("matches a regex against the whole name", () => {
    const preview = workspace("my-app-pr-42");
    const lookalike = workspace("my-app-pr-42-copy");
    const other = workspace("other-my-app-pr-7");

    const selection = selectPruneCandidates(
      [preview, lookalike, other],
      { ...baseCriteria, nameRegexes: [/^(?:my-app-pr-\d+)$/] },
      NOW,
    );

    expect(selection.candidates).toEqual([preview]);
  });

  test("matches when any of the patterns matches", () => {
    const byFirst = workspace("e2e-ws-1");
    const bySecond = workspace("my-app-pr-42");

    const selection = selectPruneCandidates(
      [byFirst, bySecond],
      { ...baseCriteria, nameRegexes: [...baseCriteria.nameRegexes, /^(?:my-app-pr-\d+)$/] },
      NOW,
    );

    expect(selection.candidates).toEqual([byFirst, bySecond]);
  });

  test("does not match a name that only contains the pattern", () => {
    const suffixed = workspace("old-e2e-ws-1");

    expect(selectPruneCandidates([suffixed], baseCriteria, NOW).candidates).toEqual([]);
  });

  test("scopes to the organization and folder when given", () => {
    const inScope = workspace("e2e-ws-a", { folderId: FOLDER_A });
    const otherOrg = workspace("e2e-ws-b", { organizationId: ORG_B, folderId: FOLDER_A });
    const otherFolder = workspace("e2e-ws-c");

    expect(
      selectPruneCandidates(
        [inScope, otherOrg, otherFolder],
        { ...baseCriteria, organizationId: ORG_A },
        NOW,
      ).candidates,
    ).toEqual([inScope, otherFolder]);
    expect(
      selectPruneCandidates(
        [inScope, otherOrg, otherFolder],
        { ...baseCriteria, organizationId: ORG_A, folderId: FOLDER_A },
        NOW,
      ).candidates,
    ).toEqual([inScope]);
  });

  test("keeps excluded names even when they match", () => {
    const keep = workspace("e2e-ws-keep");
    const drop = workspace("e2e-ws-drop");

    const selection = selectPruneCandidates(
      [keep, drop],
      { ...baseCriteria, exclude: new Set(["e2e-ws-keep"]) },
      NOW,
    );

    expect(selection.candidates).toEqual([drop]);
    expect(selection.excluded).toEqual([keep]);
  });

  test("never selects delete-protected workspaces or ones without a creation time", () => {
    const protectedWs = workspace("e2e-ws-protected", { deleteProtection: true });
    const noCreateTime = workspace("e2e-ws-unknown-age", { createdAt: null });

    const selection = selectPruneCandidates([protectedWs, noCreateTime], baseCriteria, NOW);

    expect(selection.candidates).toEqual([]);
    expect(selection.protectedSkipped).toEqual([protectedWs]);
    expect(selection.missingCreateTime).toEqual([noCreateTime]);
  });

  test("ignores the delete-protected and unknown-age flags of non-matching workspaces", () => {
    const protectedOther = workspace("production", { deleteProtection: true });

    const selection = selectPruneCandidates([protectedOther], baseCriteria, NOW);

    expect(selection.protectedSkipped).toEqual([]);
    expect(selection.missingCreateTime).toEqual([]);
  });
});

describe("workspace prune command", () => {
  aroundEach(async (runTest) => {
    vi.clearAllMocks();
    loggerState.jsonMode = false;
    vi.useFakeTimers({ now: NOW, toFake: ["Date"] });
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", undefined);
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", undefined);
    vi.stubEnv("TAILOR_PLATFORM_PROFILE", undefined);
    try {
      await runTest();
    } finally {
      vi.useRealTimers();
      vi.unstubAllEnvs();
    }
  });

  test("requires a name filter", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);

    const result = await runCommand(pruneCommand, ["--older-than", "24h", "--yes"]);

    expectFailure(result, "--name");
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  test("rejects a malformed --older-than value", async () => {
    const client = stubClient([]);

    const result = await runCommand(pruneCommand, ["--name", "e2e-ws-.*", "--older-than", "24"]);

    expectFailure(result, "older-than");
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  test("only accepts a zero age together with an organization or folder scope", async () => {
    const client = stubClient([workspace("e2e-ws-1", { createdAt: NOW })]);

    const unscoped = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "0s",
      "--yes",
    ]);
    expectFailure(unscoped, "--organization-id");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();

    const scoped = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "0s",
      "--organization-id",
      ORG_A,
      "--yes",
    ]);
    expect(scoped.success).toBe(true);
    expect(client.deleteWorkspace).toHaveBeenCalledWith({ workspaceId: "id-e2e-ws-1" });
  });

  test("anchors --name to the whole name", async () => {
    const client = stubClient([workspace("my-app-pr-42"), workspace("my-app-pr-42-copy")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "my-app-pr-\\d+",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace.mock.calls).toEqual([[{ workspaceId: "id-my-app-pr-42" }]]);
  });

  test("rejects a --name whose parentheses would escape the whole-name anchor", async () => {
    const client = stubClient([workspace("production"), workspace("temp")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "prod)|(?:temp",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expectFailure(result, "--name");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("rejects an invalid --name", async () => {
    const client = stubClient([]);

    const result = await runCommand(pruneCommand, ["--name", "(", "--older-than", "1h"]);

    expectFailure(result, "--name");
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  test("lists candidates without deleting in dry-run mode", async () => {
    const client = stubClient([workspace("e2e-ws-1"), workspace("prod")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--dry-run",
    ]);

    expect(result.success).toBe(true);
    expect(logger.out).toHaveBeenCalledWith(
      [expect.objectContaining({ id: "id-e2e-ws-1", name: "e2e-ws-1" })],
      expect.anything(),
    );
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("deletes the confirmed candidates and reports skipped workspaces", async () => {
    const client = stubClient([
      workspace("e2e-ws-1"),
      workspace("e2e-ws-2"),
      workspace("e2e-ws-protected", { deleteProtection: true }),
      workspace("e2e-ws-fresh", { createdAt: hoursAgo(1) }),
    ]);
    vi.mocked(prompt.confirm).mockResolvedValue(true);

    const result = await runCommand(pruneCommand, ["--name", "e2e-ws-.*", "--older-than", "24h"]);

    expect(result.success).toBe(true);
    expect(assertWritable).toHaveBeenCalledWith({ profile: undefined });
    expect(prompt.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("2 workspace(s)"),
        default: false,
      }),
    );
    expect(client.deleteWorkspace.mock.calls).toEqual([
      [{ workspaceId: "id-e2e-ws-1" }],
      [{ workspaceId: "id-e2e-ws-2" }],
    ]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("e2e-ws-protected"));
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("Deleted 2"));
  });

  test("skips the prompt with --yes", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(prompt.confirm).not.toHaveBeenCalled();
    expect(client.deleteWorkspace).toHaveBeenCalledTimes(1);
  });

  test("deletes nothing when the confirmation is declined", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);
    vi.mocked(prompt.confirm).mockResolvedValue(false);

    const result = await runCommand(pruneCommand, ["--name", "e2e-ws-.*", "--older-than", "24h"]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("cancelled"));
  });

  test("aborts before deleting anything when more candidates match than --limit allows", async () => {
    const client = stubClient([
      workspace("e2e-ws-1"),
      workspace("e2e-ws-2"),
      workspace("e2e-ws-3"),
    ]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--limit",
      "2",
      "--yes",
    ]);

    expectFailure(result, "3 workspaces matched, but --limit is 2");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("rejects an empty --limit instead of treating it as no cap", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--limit=",
      "--yes",
    ]);

    expectFailure(result, "limit");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("lists every candidate in dry-run mode even beyond --limit", async () => {
    const client = stubClient([
      workspace("e2e-ws-1"),
      workspace("e2e-ws-2"),
      workspace("e2e-ws-3"),
    ]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--limit",
      "2",
      "--dry-run",
    ]);

    expect(result.success).toBe(true);
    expect(logger.out).toHaveBeenCalledWith(
      [
        expect.objectContaining({ name: "e2e-ws-1" }),
        expect.objectContaining({ name: "e2e-ws-2" }),
        expect.objectContaining({ name: "e2e-ws-3" }),
      ],
      expect.anything(),
    );
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("--limit is 2"));
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("lifts the cap with --limit 0", async () => {
    const workspaces = Array.from({ length: 25 }, (_, i) => workspace(`e2e-ws-${i}`));
    const client = stubClient(workspaces);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--limit",
      "0",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).toHaveBeenCalledTimes(25);
  });

  test("applies the default limit of 20", async () => {
    const workspaces = Array.from({ length: 21 }, (_, i) => workspace(`e2e-ws-${i}`));
    const client = stubClient(workspaces);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expectFailure(result, "--limit is 20");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("keeps deleting after a failure and exits with an error", async () => {
    const client = stubClient([workspace("e2e-ws-1"), workspace("e2e-ws-2")]);
    client.deleteWorkspace
      .mockRejectedValueOnce(new Error("permission denied"))
      .mockResolvedValueOnce({});

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expectFailure(result, "Failed to delete 1 workspace(s)");
    expect(client.deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining("e2e-ws-1"));
  });

  test("fetches every page of the workspace list", async () => {
    const client = stubClient([]);
    client.listWorkspaces
      .mockResolvedValueOnce({ workspaces: [workspace("e2e-ws-1")], nextPageToken: "page-2" })
      .mockResolvedValueOnce({ workspaces: [workspace("e2e-ws-2")], nextPageToken: "" });

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.listWorkspaces).toHaveBeenCalledTimes(2);
    expect(client.listWorkspaces).toHaveBeenLastCalledWith(
      expect.objectContaining({ pageToken: "page-2" }),
    );
    expect(client.deleteWorkspace.mock.calls).toEqual([
      [{ workspaceId: "id-e2e-ws-1" }],
      [{ workspaceId: "id-e2e-ws-2" }],
    ]);
  });

  test("forwards --profile to authentication and the read-only guard", async () => {
    stubClient([]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--profile",
      "staging",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(assertWritable).toHaveBeenCalledWith({ profile: "staging" });
    expect(loadAccessToken).toHaveBeenCalledWith({ profile: "staging" });
    expect(loadPlatformClientConfig).toHaveBeenCalledWith({ profile: "staging" });
  });

  test("removes local profiles that pointed at the deleted workspaces", async () => {
    const client = stubClient([workspace("e2e-ws-1"), workspace("e2e-ws-2")]);
    vi.mocked(readPlatformConfig).mockResolvedValue({
      profiles: {
        stale: { workspace_id: "id-e2e-ws-1" },
        live: { workspace_id: "id-other" },
      },
    } as unknown as Awaited<ReturnType<typeof readPlatformConfig>>);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(writePlatformConfig).toHaveBeenCalledWith({
      profiles: { live: { workspace_id: "id-other" } },
    });
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("1 local profile(s)"));
  });

  test("treats a workspace deleted mid-run as already pruned", async () => {
    const client = stubClient([workspace("e2e-ws-1"), workspace("e2e-ws-2")]);
    client.deleteWorkspace
      .mockRejectedValueOnce(new ConnectError("workspace not found", Code.NotFound))
      .mockResolvedValueOnce({});

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).toHaveBeenCalledTimes(2);
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("already deleted"));
    expect(logger.success).toHaveBeenCalledWith(expect.stringContaining("Deleted 2"));
  });

  test("refuses to sweep when a scope environment variable is set but empty", async () => {
    const client = stubClient([workspace("e2e-ws-a", { organizationId: ORG_B })]);
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", "");

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expectFailure(result, "--organization-id");
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  test("refuses to sweep when a scope option is passed empty", async () => {
    const client = stubClient([workspace("e2e-ws-a")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--folder-id",
      "",
      "--yes",
    ]);

    expectFailure(result, "--folder-id");
    expect(client.listWorkspaces).not.toHaveBeenCalled();
  });

  test("accepts several --name patterns", async () => {
    const client = stubClient([
      workspace("e2e-ws-1"),
      workspace("my-app-pr-42"),
      workspace("production"),
    ]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--name",
      "my-app-pr-\\d+",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace.mock.calls).toEqual([
      [{ workspaceId: "id-e2e-ws-1" }],
      [{ workspaceId: "id-my-app-pr-42" }],
    ]);
  });

  test("reads the organization scope from the environment", async () => {
    const client = stubClient([
      workspace("e2e-ws-a"),
      workspace("e2e-ws-b", { organizationId: ORG_B }),
    ]);
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", ORG_A);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace.mock.calls).toEqual([[{ workspaceId: "id-e2e-ws-a" }]]);
  });

  test("emits a single JSON result instead of the table in JSON mode", async () => {
    loggerState.jsonMode = true;
    const client = stubClient([
      workspace("e2e-ws-1"),
      workspace("e2e-ws-protected", { deleteProtection: true }),
    ]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).toHaveBeenCalledTimes(1);
    expect(logger.out).toHaveBeenCalledTimes(1);
    expect(logger.out).toHaveBeenCalledWith({
      dryRun: false,
      candidates: [expect.objectContaining({ id: "id-e2e-ws-1", name: "e2e-ws-1" })],
      deleted: [expect.objectContaining({ id: "id-e2e-ws-1" })],
      failed: [],
      skipped: { excluded: [], deleteProtection: ["e2e-ws-protected"], unknownAge: [] },
    });
  });

  test("reports when nothing matched", async () => {
    const client = stubClient([workspace("prod")]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("No stale workspaces"));
  });
});
