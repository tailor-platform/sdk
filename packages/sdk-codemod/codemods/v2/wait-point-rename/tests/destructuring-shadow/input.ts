import { createWorkflow, defineWaitPoints } from "@tailor-platform/sdk";

// Top-level SDK usage — should be renamed
export const { approval } = defineWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

// Object destructuring shadows the import — calls inside should NOT be renamed
function helper(source: Record<string, () => void>) {
  const { defineWaitPoints } = source;
  return defineWaitPoints();
}

export default createWorkflow({ name: "wf", mainJob: {} as never });
