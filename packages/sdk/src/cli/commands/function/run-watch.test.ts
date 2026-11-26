import { describe, expect, test, vi } from "vitest";
import { tempCwd } from "#/cli/shared/test-helpers/temp-cwd";
import { resolveFunctionRunTarget } from "./run";
import { runFunctionWatch } from "./run-watch";
import { startFunctionRunWatch } from "./watch";
import type { FunctionRunTarget } from "./run-function";

vi.mock("./run", () => ({ resolveFunctionRunTarget: vi.fn() }));
vi.mock("./watch", () => ({ startFunctionRunWatch: vi.fn() }));

describe("runFunctionWatch", () => {
  test("watches the target selected by the options, reporting to onEvent without handling signals", async () => {
    using tmp = tempCwd("run-watch-");
    const file = `${tmp.dir}/fn.ts`;
    await import("node:fs").then((fs) => fs.writeFileSync(file, "export default 1;\n"));
    const target = { workspaceId: "ws-1" } as FunctionRunTarget;
    const handle = { closed: Promise.resolve(), close: async () => {} };
    vi.mocked(resolveFunctionRunTarget).mockResolvedValue(target);
    vi.mocked(startFunctionRunWatch).mockResolvedValue(handle);
    const onEvent = vi.fn();

    const watch = await runFunctionWatch({
      file,
      argFile: `${tmp.dir}/arg.json`,
      onEvent,
      profile: "dev",
      workspaceId: "ws-1",
    });

    expect([
      watch,
      vi.mocked(resolveFunctionRunTarget).mock.calls[0]![0],
      vi.mocked(startFunctionRunWatch).mock.calls[0]![0],
    ]).toEqual([
      handle,
      expect.objectContaining({
        filePath: file,
        profile: "dev",
        workspaceId: "ws-1",
        allowSchemaDrift: false,
      }),
      {
        target,
        argFile: `${tmp.dir}/arg.json`,
        initialArg: undefined,
        onEvent,
        handleSignals: false,
      },
    ]);
  });

  test("rejects a function file that does not exist before loading anything", async () => {
    vi.mocked(resolveFunctionRunTarget).mockClear();

    await expect(
      runFunctionWatch({ file: "/nonexistent/fn.ts", argFile: "/tmp/arg.json", onEvent: () => {} }),
    ).rejects.toMatchObject({ code: "FILE_NOT_FOUND" });
    expect(resolveFunctionRunTarget).not.toHaveBeenCalled();
  });
});
