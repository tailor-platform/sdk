import { Project, SyntaxKind, type SourceFile } from "ts-morph";

export type ParsedImport = {
  /** Module path, e.g. "@tailor-platform/sdk" or "@tailor-platform/sdk/plugin/kysely-type" */
  path: string;
  /** Named import bindings */
  named: string[];
  /** Default import binding, if any */
  defaultName: string | null;
  /** Namespace import binding, if any */
  namespaceName: string | null;
};

export type ParsedCall = {
  /** Full callee text: "foo", "db.type", "client.workflow.run" */
  callee: string;
  /** Receiver chain — for "a.b.c" calls, ["a", "b"]; empty for "foo()" */
  receiverChain: string[];
  /** Final method name */
  method: string;
  /** Whether the call is preceded by `await` */
  awaited: boolean;
  /** Number of arguments */
  argCount: number;
  /** Position of leading character */
  pos: number;
};

export type ParsedCode = {
  source: SourceFile;
  imports: ParsedImport[];
  calls: ParsedCall[];
  /** All identifier names referenced in the source. */
  identifiers: Set<string>;
  /** Lines starting with `// GUESS:` comments. */
  guessComments: { line: number; text: string }[];
};

const sharedProject = new Project({
  skipFileDependencyResolution: true,
  skipAddingFilesFromTsConfig: true,
  compilerOptions: { allowJs: true, jsx: 1, noEmit: true, target: 99, module: 99 },
});

export function parseCode(code: string, fileName = "snippet.ts"): ParsedCode {
  const sf = sharedProject.createSourceFile(fileName, code, { overwrite: true });

  const imports: ParsedImport[] = [];
  for (const imp of sf.getImportDeclarations()) {
    const named = imp.getNamedImports().map((n) => {
      const aliasNode = n.getAliasNode();
      return aliasNode ? aliasNode.getText() : n.getName();
    });
    imports.push({
      path: imp.getModuleSpecifierValue(),
      named,
      defaultName: imp.getDefaultImport()?.getText() ?? null,
      namespaceName: imp.getNamespaceImport()?.getText() ?? null,
    });
  }

  const calls: ParsedCall[] = [];
  sf.forEachDescendant((node) => {
    if (node.getKind() !== SyntaxKind.CallExpression) return;
    const expr = node.asKind(SyntaxKind.CallExpression);
    if (!expr) return;
    const callee = expr.getExpression();
    const calleeText = callee.getText();
    const parts = calleeText.split(".");
    const receiverChain = parts.slice(0, -1);
    const method = parts.at(-1) ?? calleeText;

    const parent = node.getParent();
    const awaited = parent?.getKind() === SyntaxKind.AwaitExpression;

    calls.push({
      callee: calleeText,
      receiverChain,
      method,
      awaited,
      argCount: expr.getArguments().length,
      pos: node.getStart(),
    });
  });

  const identifiers = new Set<string>();
  sf.forEachDescendant((node) => {
    if (node.getKind() === SyntaxKind.Identifier) {
      identifiers.add(node.getText());
    }
  });

  const guessComments: { line: number; text: string }[] = [];
  const text = sf.getFullText();
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*\/\/\s*GUESS\s*:?\s*(.*)$/.exec(lines[i]);
    if (m) guessComments.push({ line: i + 1, text: m[1] });
  }

  return { source: sf, imports, calls, identifiers, guessComments };
}
