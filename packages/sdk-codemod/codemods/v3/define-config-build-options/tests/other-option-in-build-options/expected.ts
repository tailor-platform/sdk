import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  buildOptions: {
    inlineSourcemap: false,
    logLevel: "WARN",
  },
});
