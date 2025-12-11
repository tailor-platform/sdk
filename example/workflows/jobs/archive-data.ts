import { createWorkflowJob } from "@tailor-platform/sdk";
import { getDB } from "../../generated/tailordb";

// This job should NOT be bundled as it's not used by any workflow
export const archiveData = createWorkflowJob({
  name: "archive-data",
  body: async (input: { beforeDate: string }) => {
    const db = getDB("tailordb");

    // This is a heavy database operation that should be tree-shaken out
    const oldOrders = await db
      .selectFrom("SalesOrder")
      .selectAll()
      .where("createdAt", "<", new Date(input.beforeDate))
      .execute();

    console.log(`Archiving ${oldOrders.length} old orders`);

    return {
      archivedCount: oldOrders.length,
      archivedAt: new Date(),
    };
  },
});
