/**
 * Shared test helpers for challenge problem tests.
 * Reduces boilerplate across test files for common assertion patterns.
 */

import fs from "node:fs";
import path from "node:path";
import { expect } from "vitest";
import { importPath } from "./helpers.js";

export type WorkDirContext = {
  workDir: string;
  workDirReady: boolean;
};

/**
 * Create a work directory context for a problem test suite.
 * Returns the resolved workDir path and whether it has node_modules installed.
 *
 * Solve mode runs in a per-run tmpdir; the runner exports `LLM_CHALLENGE_WORK_DIR`
 * so tests see the freshly-solved tree instead of a stale `problems/<id>/work`.
 */
export function createWorkDirContext(testDirname: string): WorkDirContext {
  const override = process.env.LLM_CHALLENGE_WORK_DIR;
  const workDir = override || path.resolve(testDirname, "..", "work");
  const workDirReady = fs.existsSync(path.join(workDir, "node_modules"));
  return { workDir, workDirReady };
}

/**
 * Assert that createdAt and updatedAt fields are datetime type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model shape from importPath
export function expectTimestamps(model: Record<string, any>): void {
  expect(model.fields.createdAt.type).toBe("datetime");
  expect(model.fields.updatedAt.type).toBe("datetime");
}

/**
 * Assert that a model contains all specified field names.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic model shape from importPath
export function expectFieldNames(model: Record<string, any>, fieldNames: string[]): void {
  const actual = Object.keys(model.fields);
  for (const name of fieldNames) {
    expect(actual).toContain(name);
  }
}

/**
 * Assert field type and optionally required/unique metadata.
 */
export function expectFieldType(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic field shape from importPath
  field: Record<string, any>,
  type: string,
  metadata?: { required?: boolean; unique?: boolean },
): void {
  expect(field.type).toBe(type);
  if (metadata?.required !== undefined) {
    expect(field.metadata.required).toBe(metadata.required);
  }
  if (metadata?.unique !== undefined) {
    expect(field.metadata.unique).toBe(metadata.unique);
  }
}

/**
 * Assert that an enum field has the expected allowed values.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic field shape from importPath
export function expectEnumValues(field: Record<string, any>, values: string[]): void {
  expect(field.type).toBe("enum");
  const actual = field.metadata.allowedValues.map((v: { value: string }) => v.value);
  expect(actual).toEqual(values);
}

/**
 * Assert that all specified file paths exist.
 */
export function expectFilesExist(filePaths: string[]): void {
  for (const filePath of filePaths) {
    expect(fs.existsSync(filePath), `expected ${filePath} to exist`).toBe(true);
  }
}

/**
 * Assert that an executor's operation is of kind "function" with a callable body.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic executor shape from importPath
export function expectFunctionOperation(executor: Record<string, any>): void {
  expect(executor.operation.kind).toBe("function");
  expect(typeof executor.operation.body).toBe("function");
}

/**
 * Assert that an executor has a non-empty description string.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- dynamic executor shape from importPath
export function expectNonEmptyDescription(executor: Record<string, any>): void {
  expect(executor.description).toBeDefined();
  expect(typeof executor.description).toBe("string");
  expect(executor.description.length).toBeGreaterThan(0);
}

export { importPath };
