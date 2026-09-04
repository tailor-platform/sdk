import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { deleteCommand } from "./delete";
import { createPatOperatorClient } from "./user";

vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("./user", () => ({ createPatOperatorClient: vi.fn() }));

describe("user pat delete", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertWritable).mockResolvedValue(undefined);
    vi.mocked(createPatOperatorClient).mockResolvedValue({
      deletePersonalAccessToken: vi.fn().mockResolvedValue(undefined),
    } as unknown as Awaited<ReturnType<typeof createPatOperatorClient>>);
  });

  test("applies an explicit profile to the readonly guard and operator client", async () => {
    const result = await runCommand(deleteCommand, ["token-name", "--profile", "readonly"]);

    expect(result.success).toBe(true);
    expect(assertWritable).toHaveBeenCalledWith({ profile: "readonly" });
    expect(createPatOperatorClient).toHaveBeenCalledWith("readonly");
  });
});
