import { createWorkflow, createWaitPoints } from "@tailor-platform/sdk";

// Top-level SDK usage — should be renamed
export const { approval } = createWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

// Function parameter shadows the import — should NOT rename inside
function processAll(defineWaitPoints: unknown[]) {
  return defineWaitPoints.length;
}

// Arrow function parameter shadows the import — should NOT rename inside
const processEach = (defineWaitPoints: string) => {
  return defineWaitPoints.trim();
};

export default createWorkflow({ name: "wf", mainJob: {} as never });
