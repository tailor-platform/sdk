/**
 * This test file demonstrates how to test workflows using the .trigger() method.
 *
 * Key features:
 * - Use vi.stubEnv() with WORKFLOW_TEST_ENV_KEY to set environment variables
 * - Use vi.spyOn() to mock dependent jobs
 * - Call .trigger() on jobs/workflows directly
 */
import { WORKFLOW_TEST_ENV_KEY } from "@tailor-platform/sdk/test";
import { afterEach, describe, expect, test, vi } from "vitest";
import workflow, { addNumbers, calculate, multiplyNumbers } from "./simple";

describe("workflow trigger tests", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  describe("unit tests with .body()", () => {
    test("addNumbers.body() adds two numbers", () => {
      const result = addNumbers.body({ a: 2, b: 3 }, { env: {} });
      expect(result).toBe(5);
    });

    test("multiplyNumbers.body() multiplies two numbers", () => {
      const result = multiplyNumbers.body({ x: 4, y: 5 }, { env: {} });
      expect(result).toBe(20);
    });

    test("calculate.body() with mocked dependent jobs", async () => {
      // Mock the trigger methods for dependent jobs
      vi.spyOn(addNumbers, "trigger").mockResolvedValue(5);
      vi.spyOn(multiplyNumbers, "trigger").mockResolvedValue(10);

      const result = await calculate.body({ a: 2, b: 3 }, { env: {} });

      expect(addNumbers.trigger).toHaveBeenCalledWith({ a: 2, b: 3 });
      expect(multiplyNumbers.trigger).toHaveBeenCalledWith({ x: 5, y: 2 });
      expect(result).toBe(10);
    });
  });

  describe("workflow tests", () => {
    test("workflow.mainJob.body() with mocked dependent jobs", async () => {
      // Mock the trigger methods for dependent jobs
      vi.spyOn(addNumbers, "trigger").mockResolvedValue(7);
      vi.spyOn(multiplyNumbers, "trigger").mockResolvedValue(21);

      const result = await workflow.mainJob.body({ a: 3, b: 4 }, { env: {} });

      expect(addNumbers.trigger).toHaveBeenCalledWith({ a: 3, b: 4 });
      expect(multiplyNumbers.trigger).toHaveBeenCalledWith({ x: 7, y: 3 });
      expect(result).toBe(21);
    });

    test("workflow.trigger() executes all jobs (integration)", async () => {
      // stubEnv ensures all dependent jobs' .trigger() calls use the same env
      vi.stubEnv(WORKFLOW_TEST_ENV_KEY, JSON.stringify({ NODE_ENV: "test" }));

      // No mocking - all jobs execute their actual body functions
      const result = await workflow.trigger({ a: 3, b: 4 });

      // (3 + 4) * 3 = 21
      expect(result).toBe(21);
    });
  });
});
