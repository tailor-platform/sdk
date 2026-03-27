import { applyPatternReplace, transformFile } from "../../codemod-engine";
import type { MigrationRule } from "../../types";

export const authInvokerRenameRule: MigrationRule = {
  id: "v2/auth-invoker-rename",
  name: "Rename auth.invoker() and authInvoker",
  description:
    "Renames auth.invoker() to auth.machineUser() and the authInvoker property to invoker " +
    "in executor and resolver operation configs.",
  since: "1.0.0",
  until: "2.0.0",
  async transform(ctx) {
    const filesModified: string[] = [];
    const warnings: string[] = [];

    for (const file of ctx.files) {
      const changed = await transformFile(
        file,
        (source) => {
          let result = source;
          let totalChanged = 0;

          // Pass 1: Rename *.invoker() -> *.machineUser() using AST matching
          const pass1 = applyPatternReplace(result, "$OBJ.invoker($$$ARGS)", (node) => {
            const obj = node.getMatch("OBJ")!.text();
            const args = node
              .getMultipleMatches("ARGS")
              .filter((n) => n.kind() !== ",")
              .map((n) => n.text());
            return `${obj}.machineUser(${args.join(", ")})`;
          });
          result = pass1.output;
          totalChanged += pass1.count;

          // Pass 2: Rename authInvoker -> invoker property
          if (result.includes("authInvoker")) {
            result = result.replaceAll("authInvoker", "invoker");
            totalChanged++;
          }

          return totalChanged > 0 ? result : null;
        },
        ctx.dryRun,
      );
      if (changed) filesModified.push(file);
    }

    return { changed: filesModified.length > 0, filesModified, warnings };
  },
};
