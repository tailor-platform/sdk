import { createWorkflow, createWorkflowJob } from "@tailor-platform/sdk";

export const reconcile = createWorkflowJob({
  name: "reconcile",
  body: (input: { date: string }) => ({
    reconciled: true,
    date: input.date,
  }),
});

export default createWorkflow({
  name: "daily-reconciliation",
  mainJob: reconcile,
});
