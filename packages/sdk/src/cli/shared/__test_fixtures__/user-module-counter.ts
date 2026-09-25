const state = globalThis as typeof globalThis & {
  __tailorUserModuleCounterCount?: number;
};
state.__tailorUserModuleCounterCount = (state.__tailorUserModuleCounterCount ?? 0) + 1;

export const loaded = true;
