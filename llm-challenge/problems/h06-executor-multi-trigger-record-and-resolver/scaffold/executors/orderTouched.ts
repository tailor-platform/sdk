// Default-export `createExecutor` named "order-touched" that uses
// recordTrigger({ type: order, events: ["created", "updated"] }) and whose
// function body calls recordAudit({ source: "order", reference: args.newRecord.id }).
// See problem.md for the full requirements.
