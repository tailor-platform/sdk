import { defineConfig } from "@tailor-platform/sdk";

const state = globalThis as typeof globalThis & {
  __tailorSingleEvaluationConfigCount?: number;
};
state.__tailorSingleEvaluationConfigCount = (state.__tailorSingleEvaluationConfigCount ?? 0) + 1;
if (state.__tailorSingleEvaluationConfigCount > 1) {
  throw new Error("Config evaluated more than once");
}

export default defineConfig({
  id: "11111111-1111-4111-8111-111111111111",
  name: "single-evaluation",
});
