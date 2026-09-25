import { createWorkflow, createWaitPoints } from "@tailor-platform/sdk";

// Local declaration shadows the SDK import — body usages should NOT be renamed
function defineWaitPoints() {}

defineWaitPoints();

export default createWorkflow({ name: "wf", mainJob: {} as never });
