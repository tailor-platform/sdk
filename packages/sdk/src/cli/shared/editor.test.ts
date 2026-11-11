import { describe, expect, test } from "vitest";
import { openInEditor } from "./editor";

describe("openInEditor", () => {
  test("rejects an empty editor command as EDITOR_FAILED", async () => {
    await expect(openInEditor("query.sql", "  ")).rejects.toMatchObject({
      code: "EDITOR_FAILED",
      message: "Editor command is empty.",
    });
  });

  test("reports an editor that exits with a failure as EDITOR_FAILED", async () => {
    await expect(
      openInEditor("query.sql", `${process.execPath} -e process.exit(3)`),
    ).rejects.toMatchObject({
      code: "EDITOR_FAILED",
      message: "Editor exited with code 3.",
      context: { exitCode: 3 },
    });
  });
});
