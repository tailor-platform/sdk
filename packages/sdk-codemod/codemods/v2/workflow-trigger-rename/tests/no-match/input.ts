const localWorkflowClient = {
  triggerWorkflow(name: string): string {
    return name;
  },
};

localWorkflowClient.triggerWorkflow("unrelated");
