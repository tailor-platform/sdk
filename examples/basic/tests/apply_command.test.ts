import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  compareDirectories,
  generateDetailedDiffReport,
} from "./helpers/directory_compare";

const tempDistDir = "tests/fixtures/actual";
console.info(`This test is running in directory: ${tempDistDir}`);

describe("pnpm apply command integration tests", () => {
  const expectedDir = path.join(__dirname, "fixtures/expected");
  describe("ディレクトリ比較テスト", () => {
    test("生成されたディレクトリ構造が期待値と一致する", async () => {
      const comparison = await compareDirectories(tempDistDir, expectedDir);

      if (!comparison.same) {
        console.log("Directory comparison failed:");
      }
      const report = generateDetailedDiffReport(
        comparison,
        tempDistDir,
        expectedDir,
      );
      console.log(report);

      expect(comparison.same).toBe(true);
    });
  });
});
