import { createResolver, t } from "@tailor-platform/sdk";
import { processDataJob } from "../../workflows/dataProcessing";

export default createResolver({
  name: "startProcessing",
  operation: "mutation",
  input: {
    dataId: t.string(),
    priority: t.enum(["low", "medium", "high"]),
  },
  body: ({ input }) => {
    const result = processDataJob.trigger({
      dataId: input.dataId,
      priority: input.priority,
    });
    return { triggered: true, result };
  },
  output: t.object({
    triggered: t.bool(),
    result: t.object({}, { optional: true }),
  }),
});
