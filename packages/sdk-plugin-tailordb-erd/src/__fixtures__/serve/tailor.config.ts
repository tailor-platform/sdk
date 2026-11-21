import { defineConfig } from "@tailor-platform/sdk";

export default defineConfig({
  name: "erd-serve-test",
  db: { main: { files: ["./user.ts"] } },
});
