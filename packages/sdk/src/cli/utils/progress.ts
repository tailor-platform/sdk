import { setTimeout } from "node:timers/promises";

export function createProgress(label: string, total: number) {
  let current = 0;

  const update = () => {
    current += 1;
    const percent = Math.round((current / total) * 100);
    process.stderr.write(`\r${label} ${current}/${total} (${percent}%)`);
  };

  const finish = () => {
    process.stderr.write("\n");
  };

  return { update, finish };
}

export async function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return await Promise.race([
    p,
    setTimeout(ms).then(() => {
      throw new Error(message);
    }),
  ]);
}
