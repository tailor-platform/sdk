import { createWorkflow, defineWaitPoints } from "@tailor-platform/sdk";

// Top-level SDK usage — should be renamed
export const { approval } = defineWaitPoints((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

// for-loop counter shares the name — everything inside the for is NOT renamed
for (let defineWaitPoints = 0; defineWaitPoints < 3; defineWaitPoints++) {
  void defineWaitPoints;
}

export default createWorkflow({ name: "wf", mainJob: {} as never });
