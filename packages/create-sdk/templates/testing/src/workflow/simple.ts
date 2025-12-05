import { createWorkflowJob, createWorkflow } from "@tailor-platform/sdk";

export const addNumbers = createWorkflowJob({
  name: "add-numbers",
  body: (input: { a: number; b: number }) => {
    return input.a + input.b;
  },
});

export const multiplyNumbers = createWorkflowJob({
  name: "multiply-numbers",
  body: (input: { x: number; y: number }) => {
    return input.x * input.y;
  },
});

export const calculate = createWorkflowJob({
  name: "calculate",
  body: async (input: { a: number; b: number }) => {
    const sum = await addNumbers.trigger({ a: input.a, b: input.b });
    const product = await multiplyNumbers.trigger({ x: sum, y: input.a });
    return product;
  },
});

export default createWorkflow({
  name: "simple-calculation",
  mainJob: calculate,
});
