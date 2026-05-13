import { defineConfig, defineIdp } from "@tailor-platform/sdk";

const idp = defineIdp("my-idp", {
  clients: ["default-client"],
});

export default defineConfig({
  name: "micro-challenge",
  idp: [idp],
  executor: { files: ["./executors/*.ts"] },
});
