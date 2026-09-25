import { createWorkflow, defineWaitPoints } from "@tailor-platform/sdk";

// Top-level SDK usage — should be renamed
export const { approval } = defineWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

// for...of loop variable shadows the import — everything inside the loop is NOT renamed
for (const defineWaitPoints of []) {
  void defineWaitPoints;
}

export default createWorkflow({ name: "wf", mainJob: {} as never });
