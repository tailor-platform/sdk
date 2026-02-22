import { createWorkflowJob } from "@tailor-platform/sdk";

type EnrichDataInput = {
  email: string;
  amount: number;
  items: { name: string; price: number }[];
};

type EnrichDataOutput = {
  email: string;
  amount: number;
  itemCount: number;
  averagePrice: number;
  priority: "low" | "medium" | "high";
  items: { name: string; price: number }[];
};

export const enrichData = createWorkflowJob({
  name: "enrich-data",
  body: (input: EnrichDataInput): EnrichDataOutput => {
    const itemCount = input.items.length;
    const totalPrice = input.items.reduce((sum, item) => sum + item.price, 0);
    const averagePrice = itemCount > 0 ? totalPrice / itemCount : 0;

    let priority: "low" | "medium" | "high";
    if (input.amount >= 1000) {
      priority = "high";
    } else if (input.amount >= 100) {
      priority = "medium";
    } else {
      priority = "low";
    }

    return {
      email: input.email,
      amount: input.amount,
      itemCount,
      averagePrice,
      priority,
      items: input.items,
    };
  },
});
