import { describe, expect, test, vi } from "vitest";
import workflow, { loadCustomer, onboardCustomer, sendWelcome } from "./orderWorkflow";

describe("customer onboarding workflow", () => {
  test("orchestrates dependent jobs with controlled trigger results", async () => {
    using _loadSpy = vi.spyOn(loadCustomer, "trigger").mockResolvedValue({
      id: "customer-1",
      email: "ada@example.com",
      plan: "pro" as const,
    });
    using _welcomeSpy = vi.spyOn(sendWelcome, "trigger").mockResolvedValue({
      customerId: "customer-1",
      receiptId: "welcome-customer-1",
      deliveredTo: "ada@example.com",
    });

    const result = await onboardCustomer.body({ customerId: "customer-1" }, { env: {} });

    expect(result).toEqual({
      customerId: "customer-1",
      plan: "pro",
      receiptId: "welcome-customer-1",
    });
  });

  test("runs the full workflow chain locally", async () => {
    const result = await workflow.mainJob.trigger({ customerId: "customer-2" });

    expect(result).toEqual({
      customerId: "customer-2",
      plan: "pro",
      receiptId: "welcome-customer-2",
    });
  });
});
