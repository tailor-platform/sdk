import * as fs from "node:fs";
import { stripVTControlCharacters } from "node:util";
import { Code, ConnectError } from "@connectrpc/connect";
import { NotificationSeverity } from "@tailor-platform/tailor-proto/notification_resource_pb";
import * as path from "pathe";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initOperatorClient } from "#/cli/shared/client";
import {
  loadAccessToken,
  loadStoredAccessTokenWithoutRefresh,
  platformConfigExists,
  readEnvironmentToken,
} from "#/cli/shared/context";
import { CLIError } from "#/cli/shared/errors";
import { CIPromptError, logger, setJsonDefaultAgent } from "#/cli/shared/logger";
import { tempDir } from "#/cli/shared/test-helpers/temp-dir";
import { readBannerState, writeBannerState } from "./throttle";
import {
  lookupSettledForTests,
  printNotificationBanner,
  resetNotificationLookupForTests,
  startNotificationLookup,
} from "./index";

vi.mock("std-env", async (importOriginal) => ({
  ...(await importOriginal()),
  isCI: false,
}));

vi.mock("#/cli/shared/client", async (importOriginal) => ({
  ...(await importOriginal()),
  initOperatorClient: vi.fn(),
}));

vi.mock("#/cli/shared/context", async (importOriginal) => ({
  ...(await importOriginal()),
  loadAccessToken: vi.fn(),
  loadStoredAccessTokenWithoutRefresh: vi.fn(),
  loadPlatformClientConfig: vi.fn().mockResolvedValue(undefined),
  platformConfigExists: vi.fn(),
  readEnvironmentToken: vi.fn(),
}));

function setTTY(value: boolean): Disposable {
  const streams = [process.stdin, process.stdout, process.stderr] as const;
  const saved = streams.map((s) => Object.getOwnPropertyDescriptor(s, "isTTY"));
  for (const s of streams) Object.defineProperty(s, "isTTY", { configurable: true, value });
  return {
    [Symbol.dispose]() {
      streams.forEach((s, i) => {
        const d = saved[i];
        if (d) Object.defineProperty(s, "isTTY", d);
        else Reflect.deleteProperty(s, "isTTY");
      });
    },
  };
}

function captureStderr() {
  const chunks: string[] = [];
  const spy = vi.spyOn(process.stderr, "write").mockImplementation((chunk) => {
    chunks.push(String(chunk));
    return true;
  });
  return {
    text: () => stripVTControlCharacters(chunks.join("")),
    [Symbol.dispose]() {
      spy.mockRestore();
    },
  };
}

const warning = (id: string, title: string) => ({
  id,
  severity: NotificationSeverity.WARNING,
  title,
});

function mockLookup(impl: ReturnType<typeof vi.fn>) {
  vi.mocked(initOperatorClient).mockResolvedValue({
    listMyNotifications: impl,
  } as unknown as Awaited<ReturnType<typeof initOperatorClient>>);
  return impl;
}

function resolved(notifications: ReturnType<typeof warning>[], totalCount = notifications.length) {
  return mockLookup(vi.fn().mockResolvedValue({ notifications, nextPageToken: "", totalCount }));
}

describe("notification banner", () => {
  let tmp: ReturnType<typeof tempDir>;
  let tty: Disposable;
  const stateFile = () => path.join(tmp.dir, "tailor-platform", "notification-banner.json");

  beforeEach(() => {
    vi.clearAllMocks();
    tmp = tempDir("banner-");
    tty = setTTY(true);
    resetNotificationLookupForTests();
    vi.mocked(readEnvironmentToken).mockReturnValue(undefined);
    vi.mocked(platformConfigExists).mockReturnValue(true);
    vi.mocked(loadStoredAccessTokenWithoutRefresh).mockResolvedValue({
      accessToken: "stored-token",
      platformConfig: undefined,
    });
    resolved([]);
  });

  afterEach(() => {
    tty[Symbol.dispose]();
    tmp[Symbol.dispose]();
    logger.setJsonMode(false);
    setJsonDefaultAgent(undefined);
    vi.unstubAllEnvs();
  });

  async function run(argv: string[], context: { error?: unknown } = {}) {
    startNotificationLookup(argv, { configDir: tmp.dir });
    await lookupSettledForTests();
    await printNotificationBanner(context);
  }

  test("prints the unread WARNING+ notifications after an ordinary command and records it", async () => {
    const list = resolved(
      [warning("a", "Region degraded"), warning("b", "Executor retries exceeded")],
      5,
    );
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(list).toHaveBeenCalledExactlyOnceWith(
      { pageSize: 3, minSeverity: NotificationSeverity.WARNING, unreadOnly: true },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    const text = stderr.text();
    expect(text).toContain("5 unread notifications need your attention");
    expect(text).toContain("WARNING   Region degraded");
    expect(text).toContain("…and 3 more.");
    expect(text).toContain("Run `tailor notification list` for details.");
    expect(readBannerState(stateFile())).toMatchObject({ version: 1, lastSeenIds: ["a", "b"] });
  });

  test("uses the stored login when no environment token is set", async () => {
    await run(["workspace", "list", "--profile", "staging"]);

    expect(loadStoredAccessTokenWithoutRefresh).toHaveBeenCalledWith({ profile: "staging" });
    expect(loadAccessToken).not.toHaveBeenCalled();
    expect(initOperatorClient).toHaveBeenCalledWith("stored-token", undefined, {
      renewToken: false,
    });
  });

  test("uses the profile the command will use: the last one, in any spelling", async () => {
    await run(["--profile", "first", "workspace", "list", "-p=last"]);

    expect(loadStoredAccessTokenWithoutRefresh).toHaveBeenCalledWith({ profile: "last" });
  });

  test("skips the lookup instead of refreshing a stored login that is due for renewal", async () => {
    vi.mocked(loadStoredAccessTokenWithoutRefresh).mockResolvedValue(undefined);
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(initOperatorClient).not.toHaveBeenCalled();
    expect(stderr.text()).toBe("");
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  test("names the profile in the hint when the command named one", async () => {
    resolved([warning("a", "x")]);
    using stderr = captureStderr();

    await run(["workspace", "list", "--profile", "staging"]);

    expect(stderr.text()).toContain(
      "Run `tailor notification list --profile staging` for details.",
    );
  });

  test("does not run when stdout is not a terminal", async () => {
    tty[Symbol.dispose]();
    tty = setTTY(false);
    const list = resolved([warning("a", "x")]);
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(list).not.toHaveBeenCalled();
    expect(stderr.text()).toBe("");
  });

  test("does not run under --json, the JSON env var, or a detected agent", async () => {
    const list = resolved([warning("a", "x")]);

    await run(["workspace", "list", "--json"]);
    vi.stubEnv("TAILOR_JSON_OUTPUT", "true");
    await run(["workspace", "list"]);
    vi.unstubAllEnvs();
    setJsonDefaultAgent("claude-code");
    await run(["workspace", "list"]);

    expect(list).not.toHaveBeenCalled();
  });

  test("does not run when disabled, for excluded commands, or without a command", async () => {
    const list = resolved([warning("a", "x")]);

    vi.stubEnv("TAILOR_NOTIFICATION_BANNER", "off");
    await run(["workspace", "list"]);
    vi.unstubAllEnvs();
    await run(["notification", "list"]);
    await run(["login"]);
    await run(["--profile", "x", "auth", "status"]);
    await run([]);
    await run(["deploy", "--help"]);

    expect(list).not.toHaveBeenCalled();
  });

  test("stays quiet within the throttle interval and runs again after it", async () => {
    const list = resolved([warning("a", "x")]);
    using stderr = captureStderr();
    writeBannerState(stateFile(), {
      version: 1,
      shownAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
      lastSeenIds: [],
    });

    await run(["workspace", "list"]);
    expect(list).not.toHaveBeenCalled();
    expect(stderr.text()).toBe("");

    writeBannerState(stateFile(), {
      version: 1,
      shownAt: new Date(Date.now() - 31 * 60 * 1000).toISOString(),
      lastSeenIds: [],
    });
    resetNotificationLookupForTests();
    await run(["workspace", "list"]);
    expect(list).toHaveBeenCalledOnce();
    expect(stderr.text()).toContain("unread notification");
  });

  test("never reads the login when there is no token and no config file", async () => {
    vi.mocked(platformConfigExists).mockReturnValue(false);

    await run(["workspace", "list"]);

    expect(loadStoredAccessTokenWithoutRefresh).not.toHaveBeenCalled();
    expect(initOperatorClient).not.toHaveBeenCalled();
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  test("uses an environment token without touching the config", async () => {
    vi.mocked(platformConfigExists).mockReturnValue(false);
    vi.mocked(readEnvironmentToken).mockReturnValue("env-token");

    await run(["workspace", "list"]);

    expect(loadAccessToken).not.toHaveBeenCalled();
    expect(initOperatorClient).toHaveBeenCalledWith("env-token", undefined, { renewToken: false });
  });

  test("swallows a failed lookup and leaves no state behind", async () => {
    mockLookup(vi.fn().mockRejectedValue(new ConnectError("expired", Code.Unauthenticated)));
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(stderr.text()).toBe("");
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  test("swallows a login that cannot be loaded", async () => {
    vi.mocked(loadStoredAccessTokenWithoutRefresh).mockRejectedValue(new Error("no user"));
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(stderr.text()).toBe("");
  });

  test("prints nothing and aborts the request when the lookup is still pending", async () => {
    let signal: AbortSignal | undefined;
    mockLookup(
      vi.fn().mockImplementation((_req, options: { signal: AbortSignal }) => {
        signal = options.signal;
        return new Promise(() => {});
      }),
    );
    using stderr = captureStderr();
    startNotificationLookup(["workspace", "list"], { configDir: tmp.dir });
    await vi.waitFor(() => expect(signal).toBeDefined());

    let printed = false;
    const printing = printNotificationBanner({}).then(() => (printed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(printed).toBe(true);
    await printing;

    expect(stderr.text()).toBe("");
    expect(signal?.aborted).toBe(true);
    expect(fs.existsSync(stateFile())).toBe(false);
  });

  test("records an empty inbox so it is not polled again within the interval", async () => {
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(stderr.text()).toBe("");
    expect(readBannerState(stateFile())).toMatchObject({ version: 1, lastSeenIds: [] });
  });

  test("prints nothing when JSON mode was turned on by the command's global args", async () => {
    resolved([warning("a", "x")]);
    using stderr = captureStderr();
    startNotificationLookup(["workspace", "list"], { configDir: tmp.dir });
    await lookupSettledForTests();
    logger.setJsonMode(true);

    await printNotificationBanner({});

    expect(stderr.text()).toBe("");
  });

  test("prints nothing after an authentication failure or a CI prompt refusal", async () => {
    resolved([warning("a", "x")]);
    using stderr = captureStderr();

    await run(["workspace", "list"], {
      error: CLIError({ code: "AUTH_TOKEN_NOT_FOUND", message: "log in" }),
    });
    resetNotificationLookupForTests();
    await run(["workspace", "list"], { error: new CIPromptError("prompt") });

    expect(stderr.text()).toBe("");
  });

  test("still prints after an ordinary command failure", async () => {
    resolved([warning("a", "x")]);
    using stderr = captureStderr();

    await run(["workspace", "list"], { error: new Error("deploy failed") });

    expect(stderr.text()).toContain("unread notification");
  });

  test("strips terminal escapes from titles", async () => {
    resolved([warning("a", "Bad \u001b[31mtitle\u001b[0m\u0007")]);
    using stderr = captureStderr();

    await run(["workspace", "list"]);

    expect(stderr.text()).toContain("WARNING   Bad title");
    expect(stderr.text()).not.toContain("\u0007");
  });

  test("printing with no lookup started is a no-op", async () => {
    using stderr = captureStderr();
    await printNotificationBanner({});
    expect(stderr.text()).toBe("");
  });
});
