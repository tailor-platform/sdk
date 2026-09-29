import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  buildOptions: {
    allowedRuntimeGlobals: { "@ai-sdk/gateway": ["Buffer"] },
    logLevel: "WARN",
  },
});
