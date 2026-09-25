import { createWorkflow, createWaitPoints } from "@tailor-platform/sdk";

// Top-level SDK usage — should be renamed
export const { approval } = createWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

// Optional parameter shadows the import — should NOT rename inside
function processAll(defineWaitPoints?: unknown[]) {
  return defineWaitPoints?.length;
}

export default createWorkflow({ name: "wf", mainJob: {} as never });
