import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../../generated/tailordb";

export default createResolver({
  name: "lookupInventory",
  description: "Query inventory with optional category and stock filters",
  operation: "query",
  input: {
    category: t.string({ optional: true }),
    minStock: t.int({ optional: true }),
  },
  body: async ({ input }) => {
    const db = getDB("tailordb");
    let query = db.selectFrom("Inventory").select(["id", "name", "category", "stock", "price"]);
    if (input.category !== undefined) {
      query = query.where("category", "=", input.category);
    }
    if (input.minStock !== undefined) {
      query = query.where("stock", ">=", input.minStock);
    }
    const results = await query.execute();
    return { items: results, count: results.length };
  },
  output: t.object({
    items: t.object(
      {
        id: t.string(),
        name: t.string(),
        category: t.string(),
        stock: t.int(),
        price: t.float(),
      },
      { array: true },
    ),
    count: t.int(),
  }),
});
