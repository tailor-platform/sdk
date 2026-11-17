import { expect, test, vi } from "vitest";
import { logger } from "#/cli/shared/logger";
import { loadFilesWithIgnores as loadFiles } from "#/utils/file-loader";
import { loadFilesWithIgnores } from "./file-loader";

vi.mock("#/utils/file-loader", () => ({ loadFilesWithIgnores: vi.fn() }));

test("forwards file loading and warnings to the CLI logger", () => {
  using warn = vi.spyOn(logger, "warn").mockImplementation(() => {});
  const config = { files: ["./tables/*.ts"], ignores: [] };
  const files = ["/app/tables/item.ts"];
  vi.mocked(loadFiles).mockImplementation((_config, _baseDir, reportWarning) => {
    reportWarning("fallback warning");
    return files;
  });

  expect(loadFilesWithIgnores(config, "/app/config")).toBe(files);
  expect(loadFiles).toHaveBeenCalledWith(config, "/app/config", logger.warn);
  expect(warn).toHaveBeenCalledWith("fallback warning");
});
