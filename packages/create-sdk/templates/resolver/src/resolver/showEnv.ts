import { createResolver, t } from "@tailor-platform/sdk";

const resolver = createResolver({
  name: "showEnv",
  description: "Returns environment variables from config",
  operation: "query",
  body: (context) => {
    return {
      appName: context.env.appName,
      version: context.env.version,
    };
  },
  output: t.object({
    appName: t.string(),
    version: t.int(),
  }),
});

export default resolver;
