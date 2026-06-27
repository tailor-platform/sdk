import { arg } from "politty";
import { z } from "zod";
import { defineAppCommand } from "#/cli/shared/command";
import { CLIError } from "#/cli/shared/errors";
import { logger } from "#/cli/shared/logger";
import { extractMethodName, getMethodDescriptor, listMethodNames } from "./proto-reflect";
import { renderInspectJson, renderInspectText } from "./render";

export const inspectCommand = defineAppCommand({
  name: "inspect",
  description: "Print the input message tree of an OperatorService endpoint.",
  notes:
    "Combine with the global `--json` flag for a machine-readable descriptor. Recursive type references and `oneof` membership are annotated. Use `tailor-sdk api list` to discover endpoint names.",
  examples: [
    { cmd: "GetApplication", desc: "Show fields of GetApplicationRequest." },
    {
      cmd: "CreateExecutorExecutor",
      desc: "Inspect a deeply nested input with `(oneof config)` annotations.",
    },
  ],
  args: z.strictObject({
    endpoint: arg(z.string(), {
      positional: true,
      description:
        "API endpoint to inspect (e.g., 'GetApplication' or 'tailor.v1.OperatorService/GetApplication').",
      completion: { custom: { choices: listMethodNames() } },
    }),
  }),
  run: (args) => {
    const methodName = extractMethodName(args.endpoint);
    const method = getMethodDescriptor(methodName);
    if (!method) {
      throw CLIError({
        message: `unknown method: ${methodName}`,
        suggestion: "Run `tailor-sdk api list` to see available methods.",
        command: "api inspect",
      });
    }
    if (logger.jsonMode) {
      logger.out(renderInspectJson(method));
    } else {
      logger.out(renderInspectText(method));
    }
  },
});
