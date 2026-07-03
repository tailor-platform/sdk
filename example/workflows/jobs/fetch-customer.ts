import { createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../../generated/tailordb";
import type { DateTimeString, UUIDString } from "@tailor-platform/sdk";

function serializeDateTime(value: Date | DateTimeString): string {
  return value instanceof Date ? value.toISOString() : value;
}

export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async (input: { customerId: UUIDString }) => {
    const db = getDB("tailordb");
    const customer = await db
      .selectFrom("Customer")
      .selectAll()
      .where("id", "=", input.customerId)
      .executeTakeFirst();
    if (!customer) return undefined;
    return {
      ...customer,
      createdAt: serializeDateTime(customer.createdAt),
      updatedAt: serializeDateTime(customer.updatedAt),
    };
  },
});
