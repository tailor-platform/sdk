import { describe, expect, test } from "vitest";
import path from "node:path";
import fs from "node:fs/promises";
import {
  compareDirectories,
  generateDetailedDiffReport,
} from "./helpers/directory_compare";
// import {
//   testAllGeneratedFunctions,
//   generateCombinedTestReport,
//   TestCase
// } from './helpers/function_tester';

// 事前に生成されたテストディレクトリを取得
async function getTestDirectory(): Promise<string> {
  try {
    const envFile = path.join(__dirname, ".test-env");
    const envContent = await fs.readFile(envFile, "utf-8");
    const match = envContent.match(/TAILOR_SDK_OUTPUT_DIR=(.+)/);
    if (match) {
      return match[1].trim();
    }
  } catch (error) {
    console.error("テスト環境ファイルの読み込みに失敗しました:", error);
  }
  throw new Error(
    "テストディレクトリが見つかりません。pnpm test:prepare を実行してください。",
  );
}

const tempDistDir = await getTestDirectory();
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
