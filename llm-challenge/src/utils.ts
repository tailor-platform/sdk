import { accessSync, promises as fs } from "node:fs";
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

export function pathExistsSync(filePath: string): boolean {
  try {
    accessSync(filePath);
    return true;
  } catch {
    return false;
  }
}
