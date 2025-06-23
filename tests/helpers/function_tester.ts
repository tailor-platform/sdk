/* eslint-disable @typescript-eslint/no-unsafe-function-type */

import path from "node:path";
import fs from "node:fs";
import assert from "node:assert";

export interface TestCase {
  input: any;
  expected: any;
  description?: string;
}

export interface TestResult {
  input: any;
  expected: any;
  actual: any;
  passed: boolean;
  error?: string;
  description?: string;
}

export interface FunctionTestSuite {
  functionName: string;
  functionPath: string;
  testCases: TestCase[];
  results: TestResult[];
  allPassed: boolean;
}

/**
 * 生成されたJavaScriptファイルから関数をインポートする
 * @param filePath JSファイルのパス
 * @returns インポートされた関数
 */
export async function importGeneratedFunction(
  filePath: string,
): Promise<Function> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Function file does not exist: ${filePath}`);
  }

  try {
    const absolutePath = path.resolve(filePath);
    delete require.cache[absolutePath];

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require(absolutePath);

    if (typeof module === "function") {
      return module;
    } else if (module.default && typeof module.default === "function") {
      return module.default;
    } else {
      const functionNames = Object.keys(module).filter(
        (key) => typeof module[key] === "function",
      );
      if (functionNames.length > 0) {
        return module[functionNames[0]];
      }
    }

    throw new Error(`No function found in module: ${filePath}`);
  } catch (error) {
    throw new Error(`Failed to import function from ${filePath}: ${error}`);
  }
}

/**
 * 関数を複数のテストケースで実行する
 * @param functionPath 関数ファイルのパス
 * @param testCases テストケースの配列
 * @returns テスト結果の配列
 */
export async function testFunctionWithInputs(
  functionPath: string,
  testCases: TestCase[],
): Promise<TestResult[]> {
  const func = await importGeneratedFunction(functionPath);

  return testCases.map((testCase) => {
    try {
      const result = func(testCase.input);
      let passed: boolean = true;
      try {
        assert.deepStrictEqual(result, testCase.expected);
      } catch {
        passed = false;
      }
      return {
        input: testCase.input,
        expected: testCase.expected,
        actual: result,
        passed,
        description: testCase.description,
      };
    } catch (error) {
      return {
        input: testCase.input,
        expected: testCase.expected,
        actual: null,
        error: error instanceof Error ? error.message : String(error),
        passed: false,
        description: testCase.description,
      };
    }
  });
}

/**
 * 関数テストスイートを実行する
 * @param functionName 関数名
 * @param functionPath 関数ファイルのパス
 * @param testCases テストケースの配列
 * @returns テストスイートの結果
 */
export async function runFunctionTestSuite(
  functionName: string,
  functionPath: string,
  testCases: TestCase[],
): Promise<FunctionTestSuite> {
  const results = await testFunctionWithInputs(functionPath, testCases);
  const allPassed = results.every((result) => result.passed);

  return {
    functionName,
    functionPath,
    testCases,
    results,
    allPassed,
  };
}

/**
 * 生成された全ての関数をテストする
 * @param functionsDir 関数ディレクトリのパス
 * @param testSuites 各関数のテストスイート定義
 * @returns 全てのテスト結果
 */
export async function testAllGeneratedFunctions(
  functionsDir: string,
  testSuites: Record<string, TestCase[]>,
): Promise<FunctionTestSuite[]> {
  const results: FunctionTestSuite[] = [];

  for (const [functionName, testCases] of Object.entries(testSuites)) {
    const functionPath = path.join(functionsDir, `${functionName}.js`);

    if (fs.existsSync(functionPath)) {
      const suite = await runFunctionTestSuite(
        functionName,
        functionPath,
        testCases,
      );
      results.push(suite);
    } else {
      results.push({
        functionName,
        functionPath,
        testCases,
        results: [
          {
            input: null,
            expected: null,
            actual: null,
            passed: false,
            error: `Function file not found: ${functionPath}`,
          },
        ],
        allPassed: false,
      });
    }
  }

  return results;
}

/**
 * テスト結果のレポートを生成する
 * @param testSuite テストスイートの結果
 * @returns レポート文字列
 */
export function generateTestReport(testSuite: FunctionTestSuite): string {
  const lines: string[] = [];

  lines.push(`=== Function Test Report: ${testSuite.functionName} ===`);
  lines.push(`File: ${testSuite.functionPath}`);
  lines.push(`Overall Result: ${testSuite.allPassed ? "PASS" : "FAIL"}`);
  lines.push(`Test Cases: ${testSuite.results.length}`);
  lines.push(`Passed: ${testSuite.results.filter((r) => r.passed).length}`);
  lines.push(`Failed: ${testSuite.results.filter((r) => !r.passed).length}`);
  lines.push("");

  testSuite.results.forEach((result, index) => {
    const status = result.passed ? "PASS" : "FAIL";
    const description = result.description || `Test ${index + 1}`;

    lines.push(`${index + 1}. ${description}: ${status}`);
    lines.push(`   Input: ${JSON.stringify(result.input)}`);
    lines.push(`   Expected: ${JSON.stringify(result.expected)}`);
    lines.push(`   Actual: ${JSON.stringify(result.actual)}`);

    if (result.error) {
      lines.push(`   Error: ${result.error}`);
    }
    lines.push("");
  });

  return lines.join("\n");
}

/**
 * 複数のテストスイートの統合レポートを生成する
 * @param testSuites テストスイートの配列
 * @returns 統合レポート文字列
 */
export function generateCombinedTestReport(
  testSuites: FunctionTestSuite[],
): string {
  const lines: string[] = [];

  lines.push(`=== Combined Function Test Report ===`);
  lines.push(`Total Functions: ${testSuites.length}`);
  lines.push(
    `Passed Functions: ${testSuites.filter((s) => s.allPassed).length}`,
  );
  lines.push(
    `Failed Functions: ${testSuites.filter((s) => !s.allPassed).length}`,
  );
  lines.push("");

  testSuites.forEach((suite) => {
    const status = suite.allPassed ? "PASS" : "FAIL";
    const passedTests = suite.results.filter((r) => r.passed).length;
    const totalTests = suite.results.length;

    lines.push(
      `${suite.functionName}: ${status} (${passedTests}/${totalTests})`,
    );
  });

  lines.push("");
  lines.push("=== Detailed Reports ===");

  testSuites.forEach((suite) => {
    if (!suite.allPassed) {
      lines.push(generateTestReport(suite));
    }
  });

  return lines.join("\n");
}

/**
 * 関数の実行時間を測定する
 * @param func 実行する関数
 * @param input 関数の入力
 * @returns 実行時間（ミリ秒）と結果
 */
export async function measureFunctionPerformance(
  func: Function,
  input: any,
): Promise<{ result: any; executionTime: number }> {
  const startTime = process.hrtime.bigint();
  const result = func(input);
  const endTime = process.hrtime.bigint();

  const executionTime = Number(endTime - startTime) / 1000000; // ナノ秒をミリ秒に変換

  return { result, executionTime };
}
