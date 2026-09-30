import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  logLevel:
    process.env.TAILOR_APP_LOG_LEVEL ?? "DEBUG",
});
