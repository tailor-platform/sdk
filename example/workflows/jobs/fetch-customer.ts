import { createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../../generated/tailordb";

export const fetchCustomer = createWorkflowJob({
  name: "fetch-customer",
  body: async (input: { customerId: string }) => {
    const db = getDB("tailordb");
    const customer = await db
      .selectFrom("Customer")
      .selectAll()
      .where("id", "=", input.customerId)
      .executeTakeFirst();
    return customer;
  },
});
