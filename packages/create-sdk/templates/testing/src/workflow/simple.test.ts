import { describe, expect, test, vi } from "vitest";
import { addNumbers, multiplyNumbers, calculate } from "./simple";

describe("workflow jobs", () => {
  describe("addNumbers job", () => {
    test("adds two numbers", () => {
      const result = addNumbers.body({ a: 2, b: 3 }, { env: {} });
      expect(result).toBe(5);
    });

    test("handles negative numbers", () => {
      const result = addNumbers.body({ a: -5, b: 3 }, { env: {} });
      expect(result).toBe(-2);
    });
  });

  describe("multiplyNumbers job", () => {
    test("multiplies two numbers", () => {
      const result = multiplyNumbers.body({ x: 4, y: 5 }, { env: {} });
      expect(result).toBe(20);
    });
  });

  describe("calculate job", () => {
    test("calculates (a + b) * a", async () => {
      // Mock the trigger methods for dependent jobs
      vi.spyOn(addNumbers, "trigger").mockResolvedValue(5); // 2 + 3 = 5
      vi.spyOn(multiplyNumbers, "trigger").mockResolvedValue(10); // 5 * 2 = 10

      const result = await calculate.body({ a: 2, b: 3 }, { env: {} });

      expect(addNumbers.trigger).toHaveBeenCalledWith({ a: 2, b: 3 });
      expect(multiplyNumbers.trigger).toHaveBeenCalledWith({ x: 5, y: 2 });
      expect(result).toBe(10);
    });
  });
});
