import { z } from "zod";

// Prevent legacy config keys from being silently stripped by z.object().
export const legacyAuthInvokerOption = z
  .never({ error: "`authInvoker` was renamed to `invoker`; use `invoker` instead." })
  .optional();
