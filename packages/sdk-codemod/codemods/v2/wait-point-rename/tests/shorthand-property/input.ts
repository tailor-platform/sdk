import { createWorkflow, defineWaitPoints } from "@tailor-platform/sdk";

// Object shorthand usage — should be renamed alongside the import
const api = { defineWaitPoints };

export default createWorkflow({ name: "wf", mainJob: {} as never });
