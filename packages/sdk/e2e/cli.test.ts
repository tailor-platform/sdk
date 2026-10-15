import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi, type MockInstance } from "vitest";
import {
  type CliResult,
  CliTimeoutError,
  cliTestTimeout,
  reportBudget,
  runProcess,
  tryProcess,
} from "./cli";

const node = process.execPath;

function nodeScript(code: string): string[] {
  return ["-e", code];
}

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function pidFrom(message: string): number {
  const match = /PID (\d+)/.exec(message);
  if (!match) throw new Error(`No PID line in:\n${message}`);
  return Number(match[1]);
}

function loggedLines(spy: MockInstance): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(" "));
}

function finishedResult(durationMs: number): CliResult {
  return { ok: true, exitCode: 0, signal: null, stdout: "", stderr: "", output: "", durationMs };
}

const options = { cwd: process.cwd(), label: "probe", timeoutMs: 30_000, signal: undefined };

let log: MockInstance<typeof console.log>;
let warn: MockInstance<typeof console.warn>;

beforeEach(() => {
  log = vi.spyOn(console, "log").mockImplementation(() => {});
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("tryProcess", () => {
  test("captures stdout, stderr, and the exit code of a failing child", async () => {
    const result = await tryProcess(
      node,
      nodeScript(
        'process.stdout.write("out\\n"); process.stderr.write("err\\n"); process.exitCode = 3;',
      ),
      options,
    );

    expect(result).toMatchObject({ ok: false, exitCode: 3, signal: null });
    expect(result.stdout).toBe("out\n");
    expect(result.stderr).toBe("err\n");
    expect(result.output).toContain("out\n");
    expect(result.output).toContain("err\n");
  });

  test("keeps the event loop running while the child runs", async () => {
    let ticks = 0;
    const interval = setInterval(() => ticks++, 20);

    try {
      await tryProcess(node, nodeScript("setTimeout(() => {}, 400);"), options);
    } finally {
      clearInterval(interval);
    }

    expect(ticks).toBeGreaterThan(5);
  });

  test("kills the child and rejects with its last output once the budget runs out", async () => {
    const error: unknown = await tryProcess(
      node,
      nodeScript(
        'console.log("PID " + process.pid); console.log("still-running"); setInterval(() => {}, 1000);',
      ),
      { ...options, timeoutMs: 2000 },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliTimeoutError);
    const timeout = error as CliTimeoutError;
    expect(timeout.message).toContain("probe exceeded its 2s budget");
    expect(timeout.message).toContain("still-running");
    expect(isAlive(pidFrom(timeout.message))).toBe(false);
  });

  test("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    const error: unknown = await tryProcess(
      node,
      nodeScript(
        'process.on("SIGTERM", () => {}); console.log("PID " + process.pid); setInterval(() => {}, 1000);',
      ),
      { ...options, timeoutMs: 2000, killGraceMs: 300 },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliTimeoutError);
    const timeout = error as CliTimeoutError;
    expect(timeout.killSignal).toBe("SIGKILL");
    expect(isAlive(pidFrom(timeout.message))).toBe(false);
  });

  test("kills the child and rejects once the signal aborts", async () => {
    const controller = new AbortController();
    const run = tryProcess(
      node,
      nodeScript('console.log("PID " + process.pid); setInterval(() => {}, 1000);'),
      { ...options, signal: controller.signal },
    );
    await vi.waitFor(() =>
      expect(loggedLines(log).some((line) => line.includes("PID "))).toBe(true),
    );

    controller.abort(new Error("test timed out"));
    const error: unknown = await run.catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("probe was aborted: test timed out");
    expect(isAlive(pidFrom(message))).toBe(false);
  });

  test("does not start the child once the signal has aborted", async () => {
    const marker = path.join(os.tmpdir(), `tailor-e2e-cli-${process.pid}-${Date.now()}`);

    await expect(
      tryProcess(
        node,
        nodeScript(`require("node:fs").writeFileSync(${JSON.stringify(marker)}, "")`),
        {
          ...options,
          signal: AbortSignal.abort(new Error("test timed out")),
        },
      ),
    ).rejects.toThrow("probe was not started: test timed out");
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(fs.existsSync(marker)).toBe(false);
  });

  test("treats a child that exits cleanly after its budget as timed out", async () => {
    await expect(
      tryProcess(
        node,
        nodeScript('process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);'),
        { ...options, timeoutMs: 2000 },
      ),
    ).rejects.toBeInstanceOf(CliTimeoutError);
  });

  test("logs each line with the label while keeping the raw output", async () => {
    const result = await tryProcess(
      node,
      nodeScript('process.stdout.write("a\\r\\nb\\nc");'),
      options,
    );

    expect(result.stdout).toBe("a\r\nb\nc");
    const lines = loggedLines(log).filter((line) => line.startsWith("[probe +"));
    expect(lines.map((line) => line.replace(/^\[probe \+[\d.]+s\] /, ""))).toEqual(["a", "b", "c"]);
  });

  test("decodes a multibyte character split across chunks", async () => {
    const result = await tryProcess(
      node,
      nodeScript(
        'const b = Buffer.from("あ\\n"); process.stdout.write(b.subarray(0, 1)); setTimeout(() => process.stdout.write(b.subarray(1)), 100);',
      ),
      options,
    );

    expect(result.stdout).toBe("あ\n");
    expect(loggedLines(log).some((line) => line.endsWith("] あ"))).toBe(true);
  });

  test("fails instead of truncating output beyond the capture limit", async () => {
    await expect(
      tryProcess(node, nodeScript('process.stdout.write("x".repeat(4096));'), {
        ...options,
        maxCaptureBytes: 1024,
      }),
    ).rejects.toThrow(/capture limit/);
  });

  test("rejects when the command cannot be started", async () => {
    await expect(tryProcess("/nonexistent/tailor-e2e-command", [], options)).rejects.toThrow(
      /ENOENT/,
    );
  });

  test("reports a child killed by a signal", async () => {
    const result = await tryProcess(
      node,
      nodeScript('process.kill(process.pid, "SIGKILL");'),
      options,
    );

    expect(result).toMatchObject({ ok: false, exitCode: null, signal: "SIGKILL" });
  });

  test("clears its budget timer once the child exits", async () => {
    const setTimer = vi.spyOn(globalThis, "setTimeout");
    const clearTimer = vi.spyOn(globalThis, "clearTimeout");

    await tryProcess(node, nodeScript(""), options);

    const budgetTimers = setTimer.mock.calls.flatMap((call, index) =>
      call[1] === options.timeoutMs ? [setTimer.mock.results[index]?.value] : [],
    );
    expect(budgetTimers).toHaveLength(1);
    expect(clearTimer).toHaveBeenCalledWith(budgetTimers[0]);
  });

  test("reports how much of its budget the call used", async () => {
    await tryProcess(node, nodeScript(""), options);

    expect(
      loggedLines(log).some((line) =>
        /^\[probe\] exited 0 after [\d.]+s \(\d+% of 30s budget\)$/.test(line),
      ),
    ).toBe(true);
  });
});

describe("runProcess", () => {
  test("resolves with the result when the child succeeds", async () => {
    const result = await runProcess(node, nodeScript('console.log("done");'), options);

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.stdout).toBe("done\n");
  });

  test("rejects with the exit code and the last output lines on failure", async () => {
    const error: unknown = await runProcess(
      node,
      nodeScript(
        'for (let i = 0; i < 60; i++) console.log("line-" + String(i).padStart(2, "0")); process.exitCode = 2;',
      ),
      options,
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    const message = (error as Error).message;
    expect(message).toContain("probe exited with code 2");
    expect(message).toContain("line-59");
    expect(message).not.toContain("line-09");
  });
});

describe("reportBudget", () => {
  test("annotates a call that used most of its budget when running in GitHub Actions", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");

    reportBudget("probe", finishedResult(1800), 3000);

    expect(loggedLines(log)).toContain(
      `::warning title=E2E CLI budget::probe took 1.8s (60%25 of 3s budget) in ${expect.getState().currentTestName}`,
    );
    expect(warn).not.toHaveBeenCalled();
  });

  test("warns on stderr outside GitHub Actions", () => {
    vi.stubEnv("GITHUB_ACTIONS", "");

    reportBudget("probe", finishedResult(1800), 3000);

    expect(loggedLines(log).some((line) => line.startsWith("::warning"))).toBe(false);
    expect(loggedLines(warn)).toEqual([
      `[budget warning] probe took 1.8s (60% of 3s budget) in ${expect.getState().currentTestName}`,
    ]);
  });

  test("only reports the duration below the warning share", () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");

    reportBudget("probe", finishedResult(1700), 3000);

    expect(loggedLines(log)).toEqual(["[probe] exited 0 after 1.7s (57% of 3s budget)"]);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("cliTestTimeout", () => {
  test("sums the CLI budgets a test spends and adds a minute of margin", () => {
    expect(cliTestTimeout(120_000, 300_000)).toBe(480_000);
  });
});
