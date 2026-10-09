import { promises as fs } from "node:fs";
import path from "node:path";

export function toPosix(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function tailText(value: string, max = 1_000): string {
  return value.length <= max ? value : value.slice(-max);
}

export async function pathExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function createRunId(): string {
  const timestamp = new Date().toISOString().replaceAll(/[-:.]/g, "").slice(0, 15);
  const random = Math.random().toString(36).slice(2, 8);
  return `${timestamp}-${random}`;
}

export async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  let firstError: unknown;
  async function loop(): Promise<void> {
    while (nextIndex < items.length) {
      if (firstError !== undefined) {
        return;
      }
      const item = items[nextIndex];
      nextIndex += 1;
      try {
        await worker(item);
      } catch (error) {
        firstError ??= error;
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => loop()));
  if (firstError !== undefined) {
    throw firstError instanceof Error ? firstError : new Error(String(firstError));
  }
}

export function parseJsonLines(text: string): unknown[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

export async function readJsonLines(filePath: string): Promise<unknown[]> {
  try {
    return parseJsonLines(await fs.readFile(filePath, "utf8"));
  } catch {
    return [];
  }
}

export function toContainerName(...parts: Array<string | number>): string {
  return ["llm-challenge", ...parts]
    .join("-")
    .toLowerCase()
    .replaceAll(/[^a-z0-9_.-]+/g, "-");
}
