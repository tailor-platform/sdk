import { createResolver, t } from "@tailor-platform/sdk";
import { getDB } from "../generated/db";

const resolver = createResolver({
  name: "getProduct",
  description: "Retrieves a product by ID with its category",
  operation: "query",
  input: {
    productId: t.uuid(),
  },
  body: async (context) => {
    const db = getDB("main-db");

    const product = await db
      .selectFrom("Product")
      .where("id", "=", context.input.productId)
      .selectAll()
      .executeTakeFirstOrThrow();

    const result: {
      name: string;
      price: number;
      status: string;
      categoryName: string | null;
    } = {
      name: product.name,
      price: product.price,
      status: product.status,
      categoryName: null,
    };

    if (product.categoryId) {
      const category = await db
        .selectFrom("Category")
        .where("id", "=", product.categoryId)
        .select("name")
        .executeTakeFirst();
      if (category) {
        result.categoryName = category.name;
      }
    }

    return result;
  },
  output: t.object({
    name: t.string(),
    price: t.float(),
    status: t.string(),
    categoryName: t.string({ optional: true }),
  }),
});

export default resolver;
