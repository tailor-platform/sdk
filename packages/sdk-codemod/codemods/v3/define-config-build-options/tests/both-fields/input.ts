import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "my-app",
  inlineSourcemap: false,
  cors: ["https://example.com"],
  logLevel: "WARN",
});
