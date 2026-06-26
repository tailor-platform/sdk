import { createWorkflow, createWaitPoints } from "@tailor-platform/sdk";

// Object shorthand usage — should be renamed alongside the import
const api = { createWaitPoints };

export default createWorkflow({ name: "wf", mainJob: {} as never });
