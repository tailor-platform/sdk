import * as sdk from "@tailor-platform/sdk";

export default sdk.defineConfig({
  name: "my-app",
  executor: {
    files: ["executors/**/*.ts", "!**/*.test.ts"],
    // keep tests out
  },
});
