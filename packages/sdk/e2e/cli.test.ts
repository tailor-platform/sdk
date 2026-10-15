import { afterEach, describe, expect, test, vi } from "vitest";
import {
  CLI_TEST_TIMEOUT_MARGIN_MS,
  CliTimeoutError,
  cliTestTimeout,
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

function pidFrom(output: string): number {
  const match = /PID (\d+)/.exec(output);
  if (!match) throw new Error(`No PID line in output:\n${output}`);
  return Number(match[1]);
}

function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter((resource) => resource === "Timeout").length;
}

function loggedLines(spy: { mock: { calls: unknown[][] } }): string[] {
  return spy.mock.calls.map((call) => call.map(String).join(" "));
}

const options = { cwd: process.cwd(), label: "probe", timeoutMs: 30_000 };

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("tryProcess", () => {
  test("captures stdout, stderr, and the exit code of a failing child", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

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
    vi.spyOn(console, "log").mockImplementation(() => {});
    let ticks = 0;
    const interval = setInterval(() => ticks++, 20);

    try {
      await tryProcess(node, nodeScript("setTimeout(() => {}, 400);"), options);
    } finally {
      clearInterval(interval);
    }

    expect(ticks).toBeGreaterThan(5);
  });

  test("kills the child and rejects with its output once the budget runs out", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const error: unknown = await tryProcess(
      node,
      nodeScript(
        'console.log("PID " + process.pid); console.log("still-running"); setInterval(() => {}, 1000);',
      ),
      { ...options, timeoutMs: 1000 },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliTimeoutError);
    const timeout = error as CliTimeoutError;
    expect(timeout.message).toContain("probe");
    expect(timeout.message).toContain("still-running");
    expect(isAlive(pidFrom(timeout.output))).toBe(false);
  });

  test("escalates to SIGKILL when the child ignores SIGTERM", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const error: unknown = await tryProcess(
      node,
      nodeScript(
        'process.on("SIGTERM", () => {}); console.log("PID " + process.pid); setInterval(() => {}, 1000);',
      ),
      { ...options, timeoutMs: 1000, killGraceMs: 300 },
    ).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CliTimeoutError);
    const timeout = error as CliTimeoutError;
    expect(timeout.killSignal).toBe("SIGKILL");
    expect(isAlive(pidFrom(timeout.output))).toBe(false);
  });

  test("treats a child that exits cleanly after its budget as timed out", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      tryProcess(
        node,
        nodeScript('process.on("SIGTERM", () => process.exit(0)); setInterval(() => {}, 1000);'),
        { ...options, timeoutMs: 1000 },
      ),
    ).rejects.toBeInstanceOf(CliTimeoutError);
  });

  test("logs each line with the label while keeping the raw output", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

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
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

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
    vi.spyOn(console, "log").mockImplementation(() => {});

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
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await tryProcess(
      node,
      nodeScript('process.kill(process.pid, "SIGKILL");'),
      options,
    );

    expect(result).toMatchObject({ ok: false, exitCode: null, signal: "SIGKILL" });
  });

  test("leaves no timers behind once the child exits", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const before = activeTimeouts();

    await tryProcess(node, nodeScript(""), options);

    expect(activeTimeouts()).toBe(before);
  });
});

describe("runProcess", () => {
  test("resolves with the result when the child succeeds", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

    const result = await runProcess(node, nodeScript('console.log("done");'), options);

    expect(result).toMatchObject({ ok: true, exitCode: 0 });
    expect(result.stdout).toBe("done\n");
  });

  test("rejects with the exit code and the last output lines on failure", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});

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

describe("budget report", () => {
  test("annotates a run that used most of its budget when running in GitHub Actions", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    await tryProcess(node, nodeScript("setTimeout(() => {}, 2200);"), {
      ...options,
      timeoutMs: 3000,
    });

    expect(
      loggedLines(log).some((line) => line.startsWith("::warning title=E2E CLI budget::probe")),
    ).toBe(true);
  });

  test("warns on stderr outside GitHub Actions", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await tryProcess(node, nodeScript("setTimeout(() => {}, 2200);"), {
      ...options,
      timeoutMs: 3000,
    });

    expect(loggedLines(log).some((line) => line.startsWith("::warning"))).toBe(false);
    expect(
      loggedLines(warn).some((line) => line.includes("probe") && line.includes("budget")),
    ).toBe(true);
  });

  test("stays quiet well within the budget but still reports the duration", async () => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

    await tryProcess(node, nodeScript(""), options);

    expect(loggedLines(log).some((line) => line.startsWith("::warning"))).toBe(false);
    expect(warn).not.toHaveBeenCalled();
    expect(
      loggedLines(log).some((line) =>
        /^\[probe\] exited 0 after [\d.]+s \(\d+% of 30s budget\)$/.test(line),
      ),
    ).toBe(true);
  });
});

describe("cliTestTimeout", () => {
  test("sums the CLI budgets a test spends and adds the margin", () => {
    expect(cliTestTimeout(120_000, 300_000)).toBe(420_000 + CLI_TEST_TIMEOUT_MARGIN_MS);
  });
});
