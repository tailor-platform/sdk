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
