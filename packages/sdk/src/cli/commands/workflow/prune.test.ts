// oxlint-disable local/typed-operator-client-mock -- Untyped mocks; migrate them to mockOperatorClient() when editing them.
import { runCommand as invoke } from "@politty/zod";
import { describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import { captureStderr, captureStdout } from "#/cli/shared/test-helpers/capture-output";
import { jsonMode } from "#/cli/shared/test-helpers/json-mode";
import { reclaimWorkflowRuns } from "#/cli/shared/workflow-run";
import { pruneCommand } from "./prune";

vi.mock("#/cli/shared/context", () => ({
  loadAccessToken: vi.fn().mockResolvedValue("mock-token"),
  loadWorkspaceId: vi.fn().mockResolvedValue("12345678-1234-4abc-8def-123456789012"),
  loadMachineUserName: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("#/cli/shared/client", async (importActual) => ({
  ...(await importActual<object>()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/workflow-run", async (importActual) => ({
  ...(await importActual<object>()),
  reclaimWorkflowRuns: vi.fn(),
}));

const WORKSPACE_ID = "12345678-1234-4abc-8def-123456789012";
const leftover = { kind: "job function", name: "tmp-run-r1-orphan" } as const;

function prepare(result: Partial<Awaited<ReturnType<typeof reclaimWorkflowRuns>>> = {}) {
  vi.mocked(initOperatorClient).mockResolvedValue(
    {} as Awaited<ReturnType<typeof initOperatorClient>>,
  );
  vi.mocked(reclaimWorkflowRuns)
    .mockReset()
    .mockResolvedValue({ removed: [], keptUnlabeled: [], removedUnlabeled: [], ...result });
}

describe("workflow prune", () => {
  test("removes finished runs at once, ignoring the grace that protects a waiting command", async () => {
    prepare({ removed: ["tmp-run-r1", "tmp-run-r2"] });
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(pruneCommand, []);

    expect(reclaimWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: WORKSPACE_ID,
        ignoreFinishedGrace: true,
        includeUnlabeled: false,
      }),
    );
    expect(JSON.parse(stdout.output)).toEqual({
      removed: ["tmp-run-r1", "tmp-run-r2"],
      unlabeled: { kept: [], removed: [] },
    });
  });

  test("warns about unlabeled resources it leaves, naming the flag that removes them", async () => {
    prepare({ keptUnlabeled: [leftover] });
    using _stdout = captureStdout();
    using stderr = captureStderr();

    await invoke(pruneCommand, []);

    expect(stderr.output).toContain("tmp-run-r1-orphan");
    expect(stderr.output).toContain("job function");
    expect(stderr.output).toContain("--include-unlabeled");
  });

  test("--include-unlabeled asks the sweep to remove them and says which it removed", async () => {
    prepare({ removedUnlabeled: [leftover] });
    using stdout = captureStdout();
    using _stderr = captureStderr();
    using _json = jsonMode();

    await invoke(pruneCommand, ["--include-unlabeled"]);

    expect(reclaimWorkflowRuns).toHaveBeenCalledWith(
      expect.objectContaining({ includeUnlabeled: true }),
    );
    expect(JSON.parse(stdout.output)).toMatchObject({ unlabeled: { removed: [leftover] } });
  });

  test("does not warn when nothing unlabeled is left", async () => {
    prepare({ removed: ["tmp-run-r1"] });
    using _stdout = captureStdout();
    using stderr = captureStderr();

    await invoke(pruneCommand, []);

    expect(stderr.output).not.toContain("--include-unlabeled");
  });
});
