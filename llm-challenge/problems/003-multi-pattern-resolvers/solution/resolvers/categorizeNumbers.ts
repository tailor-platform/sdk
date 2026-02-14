import { createResolver, t } from "@tailor-platform/sdk";

export default createResolver({
  name: "categorizeNumbers",
  operation: "query",
  input: {
    numbers: t.int({ array: true }),
  },
  body: ({ input }) => {
    const positives = input.numbers.filter((n) => n > 0);
    const negatives = input.numbers.filter((n) => n < 0);
    const zeros = input.numbers.filter((n) => n === 0).length;

    let summary: "all_positive" | "all_negative" | "mixed" | "empty";
    if (input.numbers.length === 0) {
      summary = "empty";
    } else if (negatives.length === 0 && zeros === 0) {
      summary = "all_positive";
    } else if (positives.length === 0 && zeros === 0) {
      summary = "all_negative";
    } else {
      summary = "mixed";
    }

    return { positives, negatives, zeros, summary };
  },
  output: t.object({
    positives: t.int({ array: true }),
    negatives: t.int({ array: true }),
    zeros: t.int(),
    summary: t.enum(["all_positive", "all_negative", "mixed", "empty"]),
  }),
});
