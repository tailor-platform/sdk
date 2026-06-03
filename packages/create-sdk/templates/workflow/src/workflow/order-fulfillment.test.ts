import { describe, expect, test, vi } from "vitest";
import workflow, {
  fulfillOrder,
  processPayment,
  sendConfirmation,
  validateOrder,
} from "./order-fulfillment";

describe("order fulfillment workflow", () => {
  describe("individual job tests with .body()", () => {
    test("validateOrder accepts valid order", () => {
      const result = validateOrder.body({ orderId: "order-1", amount: 100 }, { env: {} });
      expect(result).toEqual({ valid: true, orderId: "order-1" });
    });

    test("validateOrder rejects zero amount", () => {
      expect(() => validateOrder.body({ orderId: "order-1", amount: 0 }, { env: {} })).toThrow(
        "Order amount must be positive",
      );
    });

    test("processPayment returns transaction", () => {
      const result = processPayment.body({ orderId: "order-1", amount: 100 }, { env: {} });
      expect(result).toEqual({
        transactionId: "txn-order-1",
        amount: 100,
        status: "completed",
      });
    });

    test("sendConfirmation returns confirmation", () => {
      const result = sendConfirmation.body(
        { orderId: "order-1", transactionId: "txn-1" },
        { env: {} },
      );
      expect(result).toEqual({
        orderId: "order-1",
        transactionId: "txn-1",
        confirmed: true,
      });
    });
  });

  describe("orchestration tests with mocked triggers", () => {
    test("fulfillOrder chains all jobs", async () => {
      using _validateSpy = vi.spyOn(validateOrder, "trigger").mockResolvedValue({
        valid: true,
        orderId: "order-1",
      });
      using _paymentSpy = vi.spyOn(processPayment, "trigger").mockResolvedValue({
        transactionId: "txn-order-1",
        amount: 100,
        status: "completed" as const,
      });
      using _confirmSpy = vi.spyOn(sendConfirmation, "trigger").mockResolvedValue({
        orderId: "order-1",
        transactionId: "txn-order-1",
        confirmed: true,
      });

      const result = await fulfillOrder.body({ orderId: "order-1", amount: 100 }, { env: {} });

      expect(validateOrder.trigger).toHaveBeenCalledWith({
        orderId: "order-1",
        amount: 100,
      });
      expect(processPayment.trigger).toHaveBeenCalledWith({
        orderId: "order-1",
        amount: 100,
      });
      expect(sendConfirmation.trigger).toHaveBeenCalledWith({
        orderId: "order-1",
        transactionId: "txn-order-1",
      });
      expect(result).toEqual({
        orderId: "order-1",
        transactionId: "txn-order-1",
        confirmed: true,
        paymentStatus: "completed",
      });
    });

    test("workflow.mainJob.body() chains all jobs", async () => {
      using _validateSpy = vi.spyOn(validateOrder, "trigger").mockResolvedValue({
        valid: true,
        orderId: "order-2",
      });
      using _paymentSpy = vi.spyOn(processPayment, "trigger").mockResolvedValue({
        transactionId: "txn-order-2",
        amount: 200,
        status: "completed" as const,
      });
      using _confirmSpy = vi.spyOn(sendConfirmation, "trigger").mockResolvedValue({
        orderId: "order-2",
        transactionId: "txn-order-2",
        confirmed: true,
      });

      const result = await workflow.mainJob.body({ orderId: "order-2", amount: 200 }, { env: {} });

      expect(result).toEqual({
        orderId: "order-2",
        transactionId: "txn-order-2",
        confirmed: true,
        paymentStatus: "completed",
      });
    });
  });

  describe("integration tests with .trigger()", () => {
    test("workflow.mainJob.trigger() executes all jobs", async () => {
      const result = await workflow.mainJob.trigger({
        orderId: "order-3",
        amount: 300,
      });

      expect(result).toEqual({
        orderId: "order-3",
        transactionId: "txn-order-3",
        confirmed: true,
        paymentStatus: "completed",
      });
    });
  });
});
