import { CloneOperationStatus } from "@tailor-platform/tailor-proto/application_pb";
import { describe, test, expect, vi } from "vitest";
import {
  formatElapsed,
  hintOnInterrupt,
  reportStatus,
  resumeCommandArgs,
  resumeHint,
} from "./shared";
import type * as loggerModule from "#/cli/shared/logger";

const logged = vi.hoisted(() => ({ info: vi.fn() }));
vi.mock("#/cli/shared/logger", async (importOriginal) => ({
  ...(await importOriginal<typeof loggerModule>()),
  logger: { info: logged.info },
}));

const ref = { sourceWorkspaceId: "src", targetWorkspaceId: "dst", operationId: "op-1" };

describe("resume guidance", () => {
  test("builds a data operation get --wait command with the source, target and operation ID filled in", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(resumeHint(ref)).toBe(
      "`tailor data operation get --from src --to dst --operation-id op-1 --wait`",
    );
  });

  test("quotes a profile name containing spaces so the command can be copied and run", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(resumeHint({ ...ref, profile: "QA team" })).toContain("'--profile=QA team'");
  });

  test("includes the profile in the guidance when the command ran with one", () => {
    expect(resumeCommandArgs({ ...ref, profile: "staging" }).slice(-1)).toEqual([
      "--profile=staging",
    ]);
  });

  test("prints the guidance on Ctrl+C while waiting and removes the handler once the wait ends", async () => {
    const before = process.listenerCount("SIGINT");
    let finish!: () => void;
    const running = hintOnInterrupt(ref, () => new Promise<void>((resolve) => (finish = resolve)));

    expect(process.listenerCount("SIGINT")).toBe(before + 1);
    (process.listeners("SIGINT").at(-1) as () => void)();
    expect(logged.info).toHaveBeenCalledWith(expect.stringContaining(resumeHint(ref)));

    finish();
    await running;
    expect(process.listenerCount("SIGINT")).toBe(before);
  });

  test.each([
    [0, "0s"],
    [45_000, "45s"],
    [201_000, "3m 21s"],
    [3_900_000, "1h 5m"],
  ])("formats %i ms as %s", (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  test("reports each status change in stream mode with a timestamp", () => {
    reportStatus(CloneOperationStatus.PROCESSING);

    expect(logged.info).toHaveBeenCalledWith("status: processing", { mode: "stream" });
  });
});
