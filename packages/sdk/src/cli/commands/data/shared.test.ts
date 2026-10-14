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

describe("続きを待つコマンドの案内", () => {
  test("コピー元・コピー先・operation ID を埋めた data operation get --wait を組み立てる", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(resumeHint(ref)).toBe(
      "`tailor data operation get --from src --to dst --operation-id op-1 --wait`",
    );
  });

  test("空白を含むプロファイル名は、コピーして実行できるように引用符で囲む", () => {
    using _platform = vi.spyOn(process, "platform", "get").mockReturnValue("linux");

    expect(resumeHint({ ...ref, profile: "QA team" })).toContain("'--profile=QA team'");
  });

  test("プロファイルを使って実行したときは、同じプロファイルを案内に含める", () => {
    expect(resumeCommandArgs({ ...ref, profile: "staging" }).slice(-1)).toEqual([
      "--profile=staging",
    ]);
  });

  test("待機中に Ctrl+C されたら案内を出し、待機が終わればハンドラを外す", async () => {
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
  ])("経過時間 %i ミリ秒を %s と表示する", (ms, expected) => {
    expect(formatElapsed(ms)).toBe(expected);
  });

  test("状態の遷移を、時刻付きの stream 表示で出す", () => {
    reportStatus(CloneOperationStatus.PROCESSING);

    expect(logged.info).toHaveBeenCalledWith("status: processing", { mode: "stream" });
  });
});
