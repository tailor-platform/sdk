const scheduler = { startJobFunction: (name: string): string => name };

export function runJob(): unknown {
  return scheduler.startJobFunction("myJob");
}
