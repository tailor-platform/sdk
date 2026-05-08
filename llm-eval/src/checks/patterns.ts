import type { Signal } from "../types.ts";
import type { ParsedCall } from "./parse.ts";

/** API names that return a Promise on the SDK (forgotten-await detector). */
const ASYNC_RECEIVERS = new Set([
  "trigger", // wp.trigger() / waitPoint.trigger()
  "wait",
  "resolve",
  "run",
]);

/** API names where the *first arg should be an options object*. */
const OPTIONS_FIRST_FUNCTIONS = new Set([
  "createWorkflow",
  "createWorkflowJob",
  "createResolver",
  "createExecutor",
  "defineConfig",
  "defineAuth",
  "defineIdp",
  "defineStaticWebSite",
  "definePlugins",
  "defineWaitPoints",
  "defineWaitPoint",
  "defineSecretManager",
]);

export function checkPatterns(calls: ParsedCall[]): Signal[] {
  const out: Signal[] = [];
  for (const call of calls) {
    if (!call.awaited && ASYNC_RECEIVERS.has(call.method)) {
      out.push({ type: "forgotten_await", call: call.callee });
    }
    // Heuristic: positional-for-options when more than 1 argument is passed
    // to a function whose API takes a single options object.
    if (OPTIONS_FIRST_FUNCTIONS.has(call.method) && call.argCount > 1) {
      out.push({ type: "positional_for_options", call: call.callee });
    }
  }
  return out;
}

export function checkPreamble(rawResponse: string): Signal[] {
  const out: Signal[] = [];
  const fenceIdx = rawResponse.indexOf("```");
  if (fenceIdx > 600) {
    out.push({ type: "long_preamble", charsBeforeCode: fenceIdx });
  }
  return out;
}
