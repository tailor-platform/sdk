interface LocalTailor {
  workflow: {
    triggerWorkflow: (name: string) => Promise<string>;
  };
}

function run(tailor: LocalTailor): Promise<string> {
  return tailor.workflow.triggerWorkflow("local");
}
