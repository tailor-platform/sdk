import { SgNode } from "@ast-grep/napi";
import { vi } from "vitest";

export async function countChildNodes(run: () => unknown): Promise<number> {
  const prototype = SgNode.prototype as unknown as { children(): unknown[] };
  const spy = vi.spyOn(prototype, "children");
  try {
    await run();
    return spy.mock.results.reduce(
      (count, result) => count + (result.type === "return" ? result.value.length : 0),
      0,
    );
  } finally {
    spy.mockRestore();
  }
}
