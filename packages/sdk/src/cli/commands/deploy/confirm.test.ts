import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { confirmOwnerConflict, type OwnerConflict } from "./confirm";
import type { prompt as promptModule } from "#/cli/shared/prompt";

vi.mock("#/cli/shared/logger", () => ({
  logger: {
    log: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    newline: vi.fn(),
  },
  styles: {
    bold: (s: string) => s,
    info: (s: string) => s,
    success: (s: string) => s,
    warning: (s: string) => s,
    error: (s: string) => s,
    dim: (s: string) => s,
  },
}));

vi.mock("#/cli/shared/prompt", () => ({
  prompt: {
    confirm: vi.fn().mockResolvedValue(true),
  },
}));

describe("confirmOwnerConflict", () => {
  let prompt: typeof promptModule;

  beforeEach(async () => {
    vi.clearAllMocks();
    ({ prompt } = await import("#/cli/shared/prompt"));
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns immediately when conflicts is empty", async () => {
    await confirmOwnerConflict([], "my-app", false);
    expect(prompt.confirm).not.toHaveBeenCalled();
  });

  test("uses the id-regeneration prompt when currentOwner equals appName", async () => {
    const conflicts: OwnerConflict[] = [
      { resourceType: "Executor", resourceName: "ex-1", currentOwner: "my-app" },
    ];
    await confirmOwnerConflict(conflicts, "my-app", false);

    expect(prompt.confirm).toHaveBeenCalledTimes(1);
    const message = vi.mocked(prompt.confirm).mock.calls[0]![0]!.message;
    expect(message).toContain("Re-tag");
    expect(message).toContain("my-app");
    expect(message).not.toContain("name mismatch");
  });

  test("uses the name-mismatch prompt when currentOwner differs from appName", async () => {
    const conflicts: OwnerConflict[] = [
      { resourceType: "Executor", resourceName: "ex-1", currentOwner: "old-app" },
    ];
    await confirmOwnerConflict(conflicts, "new-app", false);

    expect(prompt.confirm).toHaveBeenCalledTimes(1);
    const message = vi.mocked(prompt.confirm).mock.calls[0]![0]!.message;
    expect(message).toContain("Update");
    expect(message).toContain("new-app");
    expect(message).not.toContain("Re-tag");
  });

  test("prompts twice when both scenarios are present", async () => {
    const conflicts: OwnerConflict[] = [
      { resourceType: "Executor", resourceName: "regenerated", currentOwner: "my-app" },
      { resourceType: "Resolver", resourceName: "renamed", currentOwner: "old-app" },
    ];
    await confirmOwnerConflict(conflicts, "my-app", false);

    expect(prompt.confirm).toHaveBeenCalledTimes(2);
    expect(vi.mocked(prompt.confirm).mock.calls[0]![0]!.message).toContain("Re-tag");
    expect(vi.mocked(prompt.confirm).mock.calls[1]![0]!.message).toContain("Update");
  });

  test.each([
    ["id regeneration", "my-app", "my-app"],
    ["name mismatch", "old-app", "new-app"],
  ])("does not prompt when yes is true (%s)", async (_label, currentOwner, appName) => {
    const conflicts: OwnerConflict[] = [
      { resourceType: "Executor", resourceName: "ex-1", currentOwner },
    ];
    await confirmOwnerConflict(conflicts, appName, true);
    expect(prompt.confirm).not.toHaveBeenCalled();
  });

  test("throws when the id-regeneration prompt is declined", async () => {
    vi.mocked(prompt.confirm).mockResolvedValueOnce(false);
    const conflicts: OwnerConflict[] = [
      { resourceType: "Executor", resourceName: "ex-1", currentOwner: "my-app" },
    ];
    await expect(confirmOwnerConflict(conflicts, "my-app", false)).rejects.toThrow(
      /tagged with the previous id/,
    );
  });

  test("throws when the name-mismatch prompt is declined", async () => {
    vi.mocked(prompt.confirm).mockResolvedValueOnce(false);
    const conflicts: OwnerConflict[] = [
      { resourceType: "Executor", resourceName: "ex-1", currentOwner: "old-app" },
    ];
    await expect(confirmOwnerConflict(conflicts, "new-app", false)).rejects.toThrow(
      /managed by their current applications/,
    );
  });
});
