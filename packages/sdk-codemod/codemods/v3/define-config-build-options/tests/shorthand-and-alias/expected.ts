import { defineConfig as config } from "@tailor-platform/sdk";

const logLevel = process.env.LOG_LEVEL ?? "INFO";

export default config({
  name: "my-app",
  buildOptions: {
    logLevel,
  },
});
