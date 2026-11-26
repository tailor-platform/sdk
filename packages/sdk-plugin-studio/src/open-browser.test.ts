import { EventEmitter } from "node:events";
import { logger } from "@tailor-platform/sdk/cli";
import open from "open";
import { afterEach, expect, test, vi } from "vitest";
import { openBrowser } from "./open-browser";

vi.mock("open", () => ({ default: vi.fn() }));

afterEach(() => {
  vi.restoreAllMocks();
});

test("opens the URL in the default browser", async () => {
  await openBrowser("http://127.0.0.1:7777/");

  expect(open).toHaveBeenCalledWith("http://127.0.0.1:7777/");
});

test("warns instead of failing when no browser can be opened, so the server keeps running", async () => {
  vi.mocked(open).mockRejectedValueOnce(new Error("no browser"));
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

  await openBrowser("http://127.0.0.1:7777/");

  expect(warn).toHaveBeenCalledWith(
    "Failed to open browser automatically. Please open the URL above manually.",
  );
});

test("warns when the launcher starts but later exits nonzero, as xdg-open does without a display", async () => {
  const launcher = new EventEmitter();
  vi.mocked(open).mockResolvedValueOnce(launcher as never);
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

  await openBrowser("http://127.0.0.1:7777/");
  expect(warn).not.toHaveBeenCalled();
  launcher.emit("exit", 3);

  expect(warn).toHaveBeenCalledWith(
    "Failed to open browser automatically. Please open the URL above manually.",
  );
});

test("stays quiet when the launcher exits with 0", async () => {
  const launcher = new EventEmitter();
  vi.mocked(open).mockResolvedValueOnce(launcher as never);
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

  await openBrowser("http://127.0.0.1:7777/");
  launcher.emit("exit", 0);

  expect(warn).not.toHaveBeenCalled();
});

test("warns when the launcher had already exited nonzero by the time open() resolved, as on Windows and WSL", async () => {
  const launcher = Object.assign(new EventEmitter(), { exitCode: 1 });
  vi.mocked(open).mockResolvedValueOnce(launcher as never);
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

  await openBrowser("http://127.0.0.1:7777/");

  expect(warn).toHaveBeenCalledWith(
    "Failed to open browser automatically. Please open the URL above manually.",
  );
});

test("stays quiet when the launcher had already exited with 0", async () => {
  const launcher = Object.assign(new EventEmitter(), { exitCode: 0 });
  vi.mocked(open).mockResolvedValueOnce(launcher as never);
  const warn = vi.spyOn(logger, "warn").mockImplementation(() => undefined);

  await openBrowser("http://127.0.0.1:7777/");

  expect(warn).not.toHaveBeenCalled();
});
