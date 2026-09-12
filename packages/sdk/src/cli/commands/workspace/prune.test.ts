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
import { encodeExpiresAt, expiresAtLabelKey } from "./expiry";
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
const FOLDER_B = "44444444-4444-4444-8444-444444444444";

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

// A workspace no organization or folder owns, which the fixture default would otherwise give one.
function personalWorkspace(
  name: string,
  overrides: Parameters<typeof workspace>[1] = {},
): Workspace {
  return workspace(name, { ...overrides, organizationId: "", folderId: "" });
}

/**
 * Stub the metadata read behind `--expired`, keyed by workspace id.
 * @param expiries - Expiry per workspace id; an absent id records no expiry, an `Error` fails the read
 * @returns The `getMetadata` stub
 */
function stubExpiries(expiries: Record<string, Date | Error>) {
  return vi.fn().mockImplementation(({ trn }: { trn: string }) => {
    const entry = expiries[trn.replace("trn:v1:workspace:", "")];
    if (entry instanceof Error) return Promise.reject(entry);
    return Promise.resolve({
      metadata: { labels: entry ? { [expiresAtLabelKey]: encodeExpiresAt(entry) } : {} },
    });
  });
}

function stubClient(workspaces: Workspace[], expiries: Record<string, Date | Error> = {}) {
  const client = {
    listWorkspaces: vi.fn().mockResolvedValue({ workspaces, nextPageToken: "" }),
    getOrganizationFolder: vi.fn().mockResolvedValue({ folder: { name: "dev" } }),
    getWorkspace: vi.fn(async ({ workspaceId }: { workspaceId: string }) => ({
      workspace: workspaces.find((candidate) => candidate.id === workspaceId),
    })),
    deleteWorkspace: vi.fn().mockResolvedValue({}),
    getMetadata: stubExpiries(expiries),
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
    organizationRoots: [],
    folderIds: [],
    personal: false,
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

  describe("locations", () => {
    const atRootA = workspace("e2e-ws-root-a");
    const atRootB = workspace("e2e-ws-root-b", { organizationId: ORG_B });
    const inFolderA = workspace("e2e-ws-folder-a", { folderId: FOLDER_A });
    const inFolderB = workspace("e2e-ws-folder-b", { folderId: FOLDER_B });
    const personal = personalWorkspace("e2e-ws-personal");
    const everywhere = [atRootA, atRootB, inFolderA, inFolderB, personal];

    test("selects every location when none is given", () => {
      expect(selectPruneCandidates(everywhere, baseCriteria, NOW).candidates).toEqual(everywhere);
    });

    test("an organization root reaches its own workspaces but none inside its folders", () => {
      expect(
        selectPruneCandidates(everywhere, { ...baseCriteria, organizationRoots: [ORG_A] }, NOW)
          .candidates,
      ).toEqual([atRootA]);
    });

    test("a folder reaches only the workspaces in that folder", () => {
      expect(
        selectPruneCandidates(everywhere, { ...baseCriteria, folderIds: [FOLDER_A] }, NOW)
          .candidates,
      ).toEqual([inFolderA]);
    });

    test("personal reaches only the workspaces no organization or folder owns", () => {
      expect(
        selectPruneCandidates(everywhere, { ...baseCriteria, personal: true }, NOW).candidates,
      ).toEqual([personal]);
    });

    test("several locations combine as a union", () => {
      expect(
        selectPruneCandidates(
          everywhere,
          { ...baseCriteria, organizationRoots: [ORG_A], folderIds: [FOLDER_B], personal: true },
          NOW,
        ).candidates,
      ).toEqual([atRootA, inFolderB, personal]);
      expect(
        selectPruneCandidates(
          everywhere,
          { ...baseCriteria, organizationRoots: [ORG_A, ORG_B], folderIds: [FOLDER_A, FOLDER_B] },
          NOW,
        ).candidates,
      ).toEqual([atRootA, atRootB, inFolderA, inFolderB]);
    });
  });

  test("does not treat a workspace with only a folder as personal", () => {
    const folderOnly = workspace("e2e-ws-a", { organizationId: "", folderId: FOLDER_A });

    expect(
      selectPruneCandidates([folderOnly], { ...baseCriteria, personal: true }, NOW).candidates,
    ).toEqual([]);
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

  test("only accepts a zero age together with a location", async () => {
    const client = stubClient([workspace("e2e-ws-1", { createdAt: NOW })]);

    const unscoped = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "0s",
      "--yes",
    ]);
    expectFailure(unscoped, "--organization-root");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();

    const scoped = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "0s",
      "--organization-root",
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

  test("refuses to sweep when a location option is passed empty", async () => {
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

  test("refuses an empty location even when another valid one is given alongside it", async () => {
    const client = stubClient([workspace("e2e-ws-a", { folderId: FOLDER_A })]);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--folder-id",
      FOLDER_A,
      "--organization-root",
      "",
      "--yes",
    ]);

    expectFailure(result, "--organization-root resolved to an empty value");
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

  test("does not read a location from the environment", async () => {
    const client = stubClient([
      workspace("e2e-ws-a"),
      workspace("e2e-ws-b", { organizationId: ORG_B }),
      workspace("e2e-ws-c", { folderId: FOLDER_A }),
    ]);
    vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", ORG_A);
    vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", FOLDER_A);

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace.mock.calls).toEqual([
      [{ workspaceId: "id-e2e-ws-a" }],
      [{ workspaceId: "id-e2e-ws-b" }],
      [{ workspaceId: "id-e2e-ws-c" }],
    ]);
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
      skipped: {
        excluded: [],
        deleteProtection: ["e2e-ws-protected"],
        unknownAge: [],
        notExpired: [],
        noExpiry: [],
        unreadableExpiry: [],
        expiryChanged: [],
        changed: [],
      },
    });
  });

  test("skips a workspace that gained delete protection after it was listed", async () => {
    const client = stubClient([workspace("e2e-ws-1"), workspace("e2e-ws-2")]);
    client.getWorkspace.mockImplementation(async ({ workspaceId }: { workspaceId: string }) => ({
      workspace:
        workspaceId === "id-e2e-ws-1"
          ? workspace("e2e-ws-1", { deleteProtection: true })
          : workspace("e2e-ws-2"),
    }));

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace.mock.calls).toEqual([[{ workspaceId: "id-e2e-ws-2" }]]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("e2e-ws-1"));
  });

  test("skips a workspace that moved out of the requested scope after it was listed", async () => {
    const client = stubClient([workspace("e2e-ws-1"), workspace("e2e-ws-2")]);
    client.getWorkspace.mockImplementation(async ({ workspaceId }: { workspaceId: string }) => ({
      workspace:
        workspaceId === "id-e2e-ws-1"
          ? workspace("e2e-ws-1", { organizationId: ORG_B })
          : workspace("e2e-ws-2"),
    }));

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--organization-root",
      ORG_A,
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace.mock.calls).toEqual([[{ workspaceId: "id-e2e-ws-2" }]]);
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("e2e-ws-1"));
  });

  test("skips a workspace that was renamed out of the name filter after it was listed", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);
    client.getWorkspace.mockResolvedValue({ workspace: workspace("kept-alive") });

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("e2e-ws-1"));
  });

  test("deletes a workspace that the re-check reports as already gone", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);
    client.getWorkspace.mockRejectedValue(new ConnectError("not found", Code.NotFound));

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expect(result.success).toBe(true);
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
    expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("already deleted"));
  });

  test("fails the workspace when the re-check itself errors", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);
    client.getWorkspace.mockRejectedValue(new Error("permission denied"));

    const result = await runCommand(pruneCommand, [
      "--name",
      "e2e-ws-.*",
      "--older-than",
      "24h",
      "--yes",
    ]);

    expectFailure(result, "Failed to delete 1 workspace(s)");
    expect(client.deleteWorkspace).not.toHaveBeenCalled();
  });

  test("removes local profiles for workspaces whose delete failed", async () => {
    const client = stubClient([workspace("e2e-ws-1")]);
    client.deleteWorkspace.mockRejectedValue(new Error("transport timeout"));
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

    expectFailure(result, "Failed to delete 1 workspace(s)");
    expect(writePlatformConfig).toHaveBeenCalledWith({
      profiles: { live: { workspace_id: "id-other" } },
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

  describe("--expired", () => {
    test("deletes only the workspaces whose recorded expiry has passed", async () => {
      const expired = workspace("ws-expired", { createdAt: hoursAgo(1) });
      const pending = workspace("ws-pending", { createdAt: hoursAgo(99) });
      const client = stubClient([expired, pending], {
        [expired.id]: hoursAgo(1),
        [pending.id]: new Date(NOW.getTime() + 3_600_000),
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: expired.id });
    });

    test("keeps a workspace whose expiry stopped selecting it before the delete", async () => {
      const target = workspace("ws-renewed", { createdAt: hoursAgo(99) });
      const client = stubClient([target], { [target.id]: hoursAgo(1) });
      // The re-read just before deleting sees a renewed expiry, as a concurrent
      // `ttl set` would leave it.
      client.getMetadata
        .mockImplementationOnce(() =>
          Promise.resolve({
            metadata: { labels: { [expiresAtLabelKey]: encodeExpiresAt(hoursAgo(1)) } },
          }),
        )
        .mockImplementation(() =>
          Promise.resolve({
            metadata: {
              labels: {
                [expiresAtLabelKey]: encodeExpiresAt(new Date(NOW.getTime() + 86_400_000)),
              },
            },
          }),
        );

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
    });

    test("keeps a workspace renewed while its details are being re-read", async () => {
      const target = workspace("ws-renewed-during-read");
      const expiries = { [target.id]: hoursAgo(1) };
      const client = stubClient([target], expiries);
      client.getWorkspace.mockImplementation(async () => {
        expiries[target.id] = new Date(NOW.getTime() + 86_400_000);
        return { workspace: target };
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.getWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: target.id });
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
      expect(writePlatformConfig).not.toHaveBeenCalled();
    });

    test.each(["workspace", "metadata"])(
      "removes stale profiles when the final %s read reports NotFound",
      async (missingAt) => {
        const target = workspace("ws-disappeared");
        const client = stubClient([target], { [target.id]: hoursAgo(1) });
        vi.mocked(readPlatformConfig).mockResolvedValue({
          profiles: {
            stale: { workspace_id: target.id },
            live: { workspace_id: "id-other" },
          },
        } as unknown as Awaited<ReturnType<typeof readPlatformConfig>>);
        vi.mocked(prompt.confirm).mockImplementation(async () => {
          const missing = new ConnectError("workspace not found", Code.NotFound);
          client.getMetadata.mockRejectedValue(missing);
          if (missingAt === "workspace") client.getWorkspace.mockRejectedValue(missing);
          return true;
        });

        const result = await runCommand(pruneCommand, ["--expired", "--organization-root", ORG_A]);

        expect(result.success).toBe(true);
        expect(client.deleteWorkspace).not.toHaveBeenCalled();
        expect(logger.info).toHaveBeenCalledWith(expect.stringContaining("already deleted"));
        expect(writePlatformConfig).toHaveBeenCalledExactlyOnceWith({
          profiles: { live: { workspace_id: "id-other" } },
        });
      },
    );

    test("keeps the workspace and its profiles when the final expiry read is denied", async () => {
      const target = workspace("ws-expiry-denied");
      const client = stubClient([target], { [target.id]: hoursAgo(1) });
      vi.mocked(readPlatformConfig).mockResolvedValue({
        profiles: { retained: { workspace_id: target.id } },
      } as unknown as Awaited<ReturnType<typeof readPlatformConfig>>);
      client.getWorkspace.mockImplementation(async () => {
        client.getMetadata.mockRejectedValue(new ConnectError("denied", Code.PermissionDenied));
        return { workspace: target };
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
      expect(writePlatformConfig).not.toHaveBeenCalled();
    });

    test("keeps local profiles when the final workspace read is denied", async () => {
      const target = workspace("ws-details-denied");
      const client = stubClient([target], { [target.id]: hoursAgo(1) });
      vi.mocked(readPlatformConfig).mockResolvedValue({
        profiles: { retained: { workspace_id: target.id } },
      } as unknown as Awaited<ReturnType<typeof readPlatformConfig>>);
      vi.mocked(prompt.confirm).mockImplementation(async () => {
        const denied = new ConnectError("denied", Code.PermissionDenied);
        client.getWorkspace.mockRejectedValue(denied);
        client.getMetadata.mockRejectedValue(denied);
        return true;
      });

      const result = await runCommand(pruneCommand, ["--expired", "--organization-root", ORG_A]);

      expectFailure(result, "Failed to delete 1 workspace(s)");
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
      expect(writePlatformConfig).not.toHaveBeenCalled();
    });

    test("keeps a workspace that records no expiry", async () => {
      const unlabelled = workspace("ws-unlabelled", { createdAt: hoursAgo(999) });
      const client = stubClient([unlabelled]);

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
    });

    test("keeps a workspace whose expiry could not be read", async () => {
      const unreadable = workspace("ws-unreadable", { createdAt: hoursAgo(999) });
      const client = stubClient([unreadable], {
        [unreadable.id]: new Error("permission denied"),
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining("permission denied"));
    });

    test("still honours delete protection and --exclude", async () => {
      const guarded = workspace("ws-guarded", { deleteProtection: true });
      const excluded = workspace("ws-excluded");
      const client = stubClient([guarded, excluded], {
        [guarded.id]: hoursAgo(1),
        [excluded.id]: hoursAgo(1),
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--exclude",
        "ws-excluded",
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
      // Delete protection is checked before the expiry read, so it costs no request.
      expect(client.getMetadata).not.toHaveBeenCalledWith({
        trn: `trn:v1:workspace:${guarded.id}`,
      });
    });

    test("narrows to the name filter when one is given", async () => {
      const matching = workspace("e2e-ws-1");
      const other = workspace("prod-1");
      const client = stubClient([matching, other], {
        [matching.id]: hoursAgo(1),
        [other.id]: hoursAgo(1),
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--name",
        "e2e-ws-.*",
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: matching.id });
    });

    test("rejects an unscoped sweep, which would delete on a metadata writer's behalf", async () => {
      const client = stubClient([workspace("ws-expired", { createdAt: hoursAgo(99) })]);

      const result = await runCommand(pruneCommand, ["--expired", "--yes"]);

      expectFailure(result, "--expired requires --organization-root, --folder-id, or --personal");
      expect(client.listWorkspaces).not.toHaveBeenCalled();
    });

    test("accepts a folder as the location", async () => {
      const target = workspace("ws-expired", { createdAt: hoursAgo(99), folderId: FOLDER_A });
      const client = stubClient([target], { [target.id]: hoursAgo(1) });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--folder-id",
        FOLDER_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: target.id });
    });

    test("an organization root leaves the expired workspaces in its folders alone", async () => {
      const atRoot = workspace("ws-root", { createdAt: hoursAgo(99) });
      const inFolder = workspace("ws-folder", { createdAt: hoursAgo(99), folderId: FOLDER_A });
      const client = stubClient([atRoot, inFolder], {
        [atRoot.id]: hoursAgo(1),
        [inFolder.id]: hoursAgo(1),
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--organization-root",
        ORG_A,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: atRoot.id });
      expect(client.getMetadata).toHaveBeenCalledTimes(2);
    });

    test("rejects being combined with --older-than", async () => {
      const client = stubClient([]);

      const result = await runCommand(pruneCommand, ["--expired", "--older-than", "24h", "--yes"]);

      expectFailure(result, "--expired and --older-than cannot be combined");
      expect(client.listWorkspaces).not.toHaveBeenCalled();
    });

    test("requires --older-than when it is not given", async () => {
      const client = stubClient([]);

      const result = await runCommand(pruneCommand, ["--name", "e2e-ws-.*", "--yes"]);

      expectFailure(result, "--older-than");
      expect(client.listWorkspaces).not.toHaveBeenCalled();
    });
  });

  describe("--personal", () => {
    test("satisfies the scope --expired requires, reaching a workspace no id scope can", async () => {
      const target = personalWorkspace("ws-expired", { createdAt: hoursAgo(99) });
      const client = stubClient([target], { [target.id]: hoursAgo(1) });

      const result = await runCommand(pruneCommand, ["--expired", "--personal", "--yes"]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: target.id });
    });

    test("leaves organization-owned workspaces alone when it is the only scope", async () => {
      const personal = personalWorkspace("ws-personal", { createdAt: hoursAgo(99) });
      const owned = workspace("ws-owned", { createdAt: hoursAgo(99) });
      const client = stubClient([personal, owned], {
        [personal.id]: hoursAgo(1),
        [owned.id]: hoursAgo(1),
      });

      const result = await runCommand(pruneCommand, ["--expired", "--personal", "--yes"]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: personal.id });
    });

    test("combines with the other locations as a union", async () => {
      const personal = personalWorkspace("ws-personal", { createdAt: hoursAgo(99) });
      const atRoot = workspace("ws-root", { createdAt: hoursAgo(99) });
      const inFolderA = workspace("ws-folder-a", { createdAt: hoursAgo(99), folderId: FOLDER_A });
      const inFolderB = workspace("ws-folder-b", { createdAt: hoursAgo(99), folderId: FOLDER_B });
      const all = [personal, atRoot, inFolderA, inFolderB];
      const client = stubClient(all, Object.fromEntries(all.map((ws) => [ws.id, hoursAgo(1)])));

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--personal",
        "--folder-id",
        FOLDER_A,
        "--folder-id",
        FOLDER_B,
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace.mock.calls).toEqual([
        [{ workspaceId: personal.id }],
        [{ workspaceId: inFolderA.id }],
        [{ workspaceId: inFolderB.id }],
      ]);
    });

    test("ignores a location left in the environment, so the sweep stays personal", async () => {
      vi.stubEnv("TAILOR_PLATFORM_ORGANIZATION_ID", ORG_A);
      vi.stubEnv("TAILOR_PLATFORM_FOLDER_ID", FOLDER_A);
      const personal = personalWorkspace("ws-personal", { createdAt: hoursAgo(99) });
      const atRoot = workspace("ws-root", { createdAt: hoursAgo(99) });
      const inFolder = workspace("ws-folder", { createdAt: hoursAgo(99), folderId: FOLDER_A });
      const client = stubClient([personal, atRoot, inFolder], {
        [personal.id]: hoursAgo(1),
        [atRoot.id]: hoursAgo(1),
        [inFolder.id]: hoursAgo(1),
      });

      const result = await runCommand(pruneCommand, ["--expired", "--personal", "--yes"]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: personal.id });
    });

    test("does not satisfy the empty-location check on an --organization-root passed empty", async () => {
      const client = stubClient([personalWorkspace("ws-expired", { createdAt: hoursAgo(99) })]);

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--personal",
        "--organization-root",
        "",
        "--yes",
      ]);

      expectFailure(result, "--organization-root resolved to an empty value");
      expect(client.listWorkspaces).not.toHaveBeenCalled();
    });

    test("still honours delete protection, --exclude, and --name", async () => {
      const target = personalWorkspace("e2e-ws-target", { createdAt: hoursAgo(99) });
      const excluded = personalWorkspace("e2e-ws-keep", { createdAt: hoursAgo(99) });
      const guarded = personalWorkspace("e2e-ws-guarded", {
        createdAt: hoursAgo(99),
        deleteProtection: true,
      });
      const otherName = personalWorkspace("other-ws", { createdAt: hoursAgo(99) });
      const client = stubClient([target, excluded, guarded, otherName], {
        [target.id]: hoursAgo(1),
        [excluded.id]: hoursAgo(1),
        [guarded.id]: hoursAgo(1),
        [otherName.id]: hoursAgo(1),
      });

      const result = await runCommand(pruneCommand, [
        "--expired",
        "--personal",
        "--name",
        "e2e-ws-.*",
        "--exclude",
        "e2e-ws-keep",
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: target.id });
    });

    test("counts as a scope for --older-than 0s as well", async () => {
      const target = personalWorkspace("e2e-ws-1", { createdAt: NOW });
      const client = stubClient([target]);

      const result = await runCommand(pruneCommand, [
        "--name",
        "e2e-ws-.*",
        "--older-than",
        "0s",
        "--personal",
        "--yes",
      ]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).toHaveBeenCalledExactlyOnceWith({ workspaceId: target.id });
    });

    test("keeps a personal workspace that records no expiry", async () => {
      const client = stubClient([personalWorkspace("ws-personal", { createdAt: hoursAgo(99) })]);

      const result = await runCommand(pruneCommand, ["--expired", "--personal", "--yes"]);

      expect(result.success).toBe(true);
      expect(client.deleteWorkspace).not.toHaveBeenCalled();
    });

    test("keeps the scope columns hidden when it is the only scope", async () => {
      const personal = personalWorkspace("ws-personal", { createdAt: hoursAgo(99) });
      stubClient([personal], { [personal.id]: hoursAgo(1) });

      const result = await runCommand(pruneCommand, ["--expired", "--personal", "--dry-run"]);

      expect(result.success).toBe(true);
      expect(logger.out).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          display: expect.objectContaining({ organizationId: null, folderId: null }),
        }),
      );
    });
  });
});
