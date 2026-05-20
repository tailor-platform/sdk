import { z } from "zod";
import { defineAppCommand } from "@/cli/shared/command";
import { logger } from "@/cli/shared/logger";
import { listMethodNames } from "./proto-reflect";

export const listCommand = defineAppCommand({
  name: "list",
  description: "List all invocable OperatorService methods.",
  notes:
    "Only unary RPCs are listed; streaming methods are excluded because `tailor-sdk api run` issues a single JSON POST and reads one JSON response.",
  args: z.object({}).strict(),
  run: () => {
    const names = listMethodNames();
    if (logger.jsonMode) {
      logger.out(names);
    } else {
      for (const name of names) logger.out(name);
    }
  },
});
