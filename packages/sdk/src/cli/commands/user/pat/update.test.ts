import { runCommand } from "politty";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { assertWritable } from "#/cli/shared/readonly-guard";
import { updateCommand } from "./update";
import { createPatOperatorClient } from "./user";

vi.mock("#/cli/shared/readonly-guard", () => ({ assertWritable: vi.fn() }));
vi.mock("./user", () => ({ createPatOperatorClient: vi.fn() }));

describe("user pat update", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(assertWritable).mockResolvedValue(undefined);
    vi.mocked(createPatOperatorClient).mockResolvedValue({
      deletePersonalAccessToken: vi.fn().mockResolvedValue(undefined),
      createPersonalAccessToken: vi.fn().mockResolvedValue({ accessToken: "token" }),
    } as unknown as Awaited<ReturnType<typeof createPatOperatorClient>>);
  });

  test("applies an explicit profile to the readonly guard and operator client", async () => {
    const result = await runCommand(updateCommand, ["token-name", "--profile", "readonly"]);

    expect(result.success).toBe(true);
    expect(assertWritable).toHaveBeenCalledWith({ profile: "readonly" });
    expect(createPatOperatorClient).toHaveBeenCalledWith("readonly");
  });
});
