// Build the approval workflow.
// - Named export `approval`: a typed wait point payload { message } / result { approved }.
// - Named export `processApproval`: a WorkflowJob named "process-approval".
// - Default export: createWorkflow({ name: "approval-workflow", mainJob: processApproval }).
// See problem.md for the full requirements.
