import { childValue } from "./child";

const state = globalThis as typeof globalThis & {
  __tailorNoncePropagationEntryCount?: number;
};
state.__tailorNoncePropagationEntryCount = (state.__tailorNoncePropagationEntryCount ?? 0) + 1;

export const entryValue: number = childValue;
