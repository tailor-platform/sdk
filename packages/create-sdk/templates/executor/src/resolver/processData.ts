import { createResolver, t } from "@tailor-platform/sdk";

const resolver = createResolver({
  name: "processData",
  description: "Processes data and returns a summary",
  operation: "mutation",
  input: {
    data: t.string(),
  },
  body: (context) => {
    return {
      processed: true,
      summary: `Processed: ${context.input.data}`,
    };
  },
  output: t.object({
    processed: t.bool(),
    summary: t.string(),
  }),
});

export default resolver;
