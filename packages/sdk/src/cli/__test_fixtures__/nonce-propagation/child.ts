const state = globalThis as typeof globalThis & {
  __tailorNoncePropagationChildCount?: number;
};
state.__tailorNoncePropagationChildCount = (state.__tailorNoncePropagationChildCount ?? 0) + 1;

export const childValue: number = 1;
