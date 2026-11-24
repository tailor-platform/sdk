import {
  findImportStatements,
  followingComma,
  importSource,
  ownLineRange,
} from "../ast-grep-helpers";
import { SDK_MODULE, type ConfigModule } from "./config-module";
import { applyEdits, replaceNode, type TextEdit } from "./text";

/** The comment `tailor deploy` writes above the `id` it adds to a config. */
const ID_COMMENT =
  "// SDK-managed app id — do not edit, except when copying this config to a separate app.";

/**
 * Edits that make a config call `functionName` instead of the SDK's `defineConfig`, keeping
 * how the file reaches the SDK (a named import, an alias, or a namespace import).
 * @param member - The config
 * @param functionName - `defineApp` or `defineWorkspace`
 * @returns The edits
 */
function renameDefineConfigEdits(member: ConfigModule, functionName: string): TextEdit[] {
  const callee = member.callee;
  if (callee.kind() === "member_expression") {
    return [replaceNode(callee.children().at(-1)!, functionName)];
  }
  const edits: TextEdit[] = [];
  for (const statement of findImportStatements(member.module.root)) {
    if (importSource(statement) !== SDK_MODULE) continue;
    for (const specifier of statement.findAll({ rule: { kind: "import_specifier" } })) {
      const names = specifier.children().filter((child) => child.kind() === "identifier");
      if (names[0]?.text() !== "defineConfig") continue;
      if ((names[1] ?? names[0]).text() !== callee.text()) continue;
      edits.push(replaceNode(names[0], functionName));
    }
  }
  if (callee.text() === "defineConfig") edits.push(replaceNode(callee, functionName));
  return edits;
}

/**
 * Rewrite a config to `defineApp()`: rename the call and drop its `id`.
 * @param member - The config
 * @returns The new file contents
 */
export function toDefineApp(member: ConfigModule): string {
  const source = member.module.source;
  const edits = renameDefineConfigEdits(member, "defineApp");
  const id = member.entries.find((entry) => entry.key === "id");
  if (id) {
    const line = ownLineRange(source, id.node);
    if (line) {
      const previous = source.lastIndexOf("\n", line.start - 2) + 1;
      const start =
        line.start > 0 && source.slice(previous, line.start).trim() === ID_COMMENT
          ? previous
          : line.start;
      edits.push({ ...line, start, text: "" });
    } else {
      const comma = followingComma(id.node);
      const end = comma ? comma.range().end.index : id.node.range().end.index;
      const trailing = /^\s*/u.exec(source.slice(end))![0].length;
      edits.push({ start: id.node.range().start.index, end: end + trailing, text: "" });
    }
  }
  return applyEdits(source, edits);
}

/**
 * Rewrite a config to `defineWorkspace()` in place, replacing the object it passes.
 * @param member - The config
 * @param objectText - The workspace config object
 * @returns The new file contents
 */
export function toDefineWorkspaceInPlace(member: ConfigModule, objectText: string): string {
  return applyEdits(member.module.source, [
    ...renameDefineConfigEdits(member, "defineWorkspace"),
    replaceNode(member.config, objectText),
  ]);
}
