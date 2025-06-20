import { describe, expect, test } from "vitest";
import path from "node:path";
import {
  compareDirectories,
  generateDetailedDiffReport,
} from "./helpers/directory_compare";
import {
  createTempDirectory,
  getDirectoryStructure,
} from "./helpers/file_utils";
import { defineWorkspace } from "../src/app";
import config from "../tailor.config";
// import {
//   testAllGeneratedFunctions,
//   generateCombinedTestReport,
//   TestCase
// } from './helpers/function_tester';

const tempOutputDir = await createTempDirectory("apply-test-");
const tempDistDir = path.join(tempOutputDir, "dist");
await defineWorkspace(config, tempDistDir).apply();

console.info(`This test is running in directory: ${tempOutputDir}`);

describe("pnpm apply command integration tests", () => {
  const expectedDir = path.join(__dirname, "fixtures/expected");
  describe("ディレクトリ比較テスト", () => {
    test("生成されたディレクトリ構造が期待値と一致する", async () => {
      const comparison = await compareDirectories(tempDistDir, expectedDir);

      if (!comparison.same) {
        const report = generateDetailedDiffReport(
          comparison,
          tempDistDir,
          expectedDir,
        );
        console.log("Directory comparison failed:");
        console.log(report);

        console.log("\nActual directory structure:");
        console.log(getDirectoryStructure(tempDistDir));

        console.log("\nExpected directory structure:");
        console.log(getDirectoryStructure(expectedDir));
      }

      expect(comparison.same).toBe(true);
    });
  });

  // describe('関数実行テスト', () => {
  //   const functionTestCases: Record<string, TestCase[]> = {
  //     helloWorld: [
  //       {
  //         input: { name: 'Test' },
  //         expected: { message: 'Hello, Test!' },
  //         description: 'Hello with name'
  //       },
  //       {
  //         input: {},
  //         expected: { message: 'Hello, World!' },
  //         description: 'Hello without name'
  //       },
  //       {
  //         input: { name: '' },
  //         expected: { message: 'Hello, World!' },
  //         description: 'Hello with empty name'
  //       }
  //     ]
  //   };

  //   test('生成された関数が正しく実行される', async () => {
  //     const functionsDir = path.join(tempOutputDir, 'dist', 'functions');

  //     // functionsディレクトリが存在する場合のみテスト実行
  //     const testResults = await testAllGeneratedFunctions(functionsDir, functionTestCases);

  //     const report = generateCombinedTestReport(testResults);
  //     console.log('Function test report:');
  //     console.log(report);

  //     // 全ての関数テストが成功することを確認
  //     const allPassed = testResults.every(suite => suite.allPassed);
  //     expect(allPassed).toBe(true);
  //   }, 30000);
  // });
});
