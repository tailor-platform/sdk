import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  logLevel: "WARN",
  buildOptions: {
    allowedRuntimeGlobals: { "@ai-sdk/gateway": ["Buffer"] }
  },
});
