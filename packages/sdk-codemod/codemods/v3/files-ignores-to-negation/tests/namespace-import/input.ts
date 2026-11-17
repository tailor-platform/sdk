import * as sdk from "@tailor-platform/sdk";

export default sdk.defineConfig({
  name: "my-app",
  executor: {
    files: ["executors/**/*.ts"],
    ignores: ["**/*.test.ts"], // keep tests out
  },
});
