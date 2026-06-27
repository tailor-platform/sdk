import { createWorkflow, defineWaitPoints } from "@tailor-platform/sdk";

// Top-level SDK usage — should be renamed
export const { approval } = defineWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

function helper() {
  // Nested local shadow — these should NOT be renamed
  function defineWaitPoints() {}
  defineWaitPoints();
}

export default createWorkflow({ name: "wf", mainJob: {} as never });
