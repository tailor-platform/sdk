import { defineWaitPoints as wp, defineWaitPoint as single } from "@tailor-platform/sdk";

export const { approval } = wp((define) => ({
  approval: define<{ message: string }, { approved: boolean }>(),
}));

export const step = single<undefined, { ok: boolean }>("step");
