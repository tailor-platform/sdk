import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { RunCellOutput } from "../runner/cell.ts";

export async function writeMatrixJson(filePath: string, cells: RunCellOutput[]): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, JSON.stringify({ cells }, null, 2), "utf8");
}
