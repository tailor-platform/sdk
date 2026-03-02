import { createResolver, t } from "@tailor-platform/sdk";

const resolver = createResolver({
  name: "showEnv",
  description: "Returns environment variables from config",
  operation: "query",
  body: (context) => {
    return {
      appName: context.env.appName as string,
      version: context.env.version as number,
    };
  },
  output: t.object({
    appName: t.string(),
    version: t.int(),
  }),
});

export default resolver;
