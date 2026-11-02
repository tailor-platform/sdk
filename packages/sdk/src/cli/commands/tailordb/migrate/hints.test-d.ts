import { assertType, describe, test } from "vitest";
import type { formatNamespaceMigrationHint, migrationCommandArgs } from "./hints";

type NamespaceHintSubcommand = Parameters<typeof formatNamespaceMigrationHint>[0]["subcommand"];
type CommandArgsSubcommand = Parameters<typeof migrationCommandArgs>[0];

describe("migration hint subcommands", () => {
  test("accept a migration subcommand followed by its arguments", () => {
    assertType<NamespaceHintSubcommand>(["sync", "0001", "--force"]);
    assertType<CommandArgsSubcommand>(["status"]);
  });

  test("reject a name that is not a migration subcommand", () => {
    // @ts-expect-error `set` is not a `tailor tailordb migration` subcommand
    assertType<NamespaceHintSubcommand>(["set", "0001"]);
    // @ts-expect-error `set` is not a `tailor tailordb migration` subcommand
    assertType<CommandArgsSubcommand>(["set", "0001"]);
  });
});
