export function recordAudit(args: { source: string; reference: string }): { entry: string } {
  return { entry: `${args.source}:${args.reference}` };
}
