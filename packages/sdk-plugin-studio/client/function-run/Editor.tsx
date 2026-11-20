import { javascript, javascriptLanguage } from "@codemirror/lang-javascript";
import { linter, setDiagnostics, type Diagnostic } from "@codemirror/lint";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView, placeholder as placeholderExtension } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

const typescriptSupport = javascript({ typescript: true });

function syntaxErrors(source: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  typescriptSupport.language.parser.parse(source).iterate({
    enter: (node) => {
      if (!node.type.isError) return;
      const to = Math.min(Math.max(node.to, node.from + 1), source.length);
      found.push({ from: Math.min(node.from, to), to, severity: "error", message: "Syntax error" });
    },
  });
  return found;
}

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
  label: string;
  typescript?: boolean;
  placeholder?: string;
  diagnostics?: Diagnostic[];
  invalid?: boolean;
}

export function Editor({
  value,
  onChange,
  dark,
  label,
  typescript = false,
  placeholder,
  diagnostics = [],
  invalid = false,
}: EditorProps) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const theme = useRef(new Compartment());
  const latest = useRef({ onChange, dark });
  latest.current = { onChange, dark };

  useEffect(() => {
    const editor = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          typescript
            ? [typescriptSupport, linter((view) => syntaxErrors(view.state.doc.toString()))]
            : javascriptLanguage.configure({ top: "SingleExpression" }).extension,
          EditorView.contentAttributes.of({ "aria-label": label }),
          ...(placeholder === undefined ? [] : [placeholderExtension(placeholder)]),
          theme.current.of(latest.current.dark ? oneDark : []),
          EditorView.theme({
            "&": { fontSize: "0.9375rem", height: "100%" },
            ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
            "&.cm-editor": { backgroundColor: "var(--card)" },
            ".cm-gutters": {
              backgroundColor: "var(--card)",
              borderRight: "1px solid var(--border)",
              color: "var(--muted-foreground)",
            },
            ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "var(--muted)" },
            ".cm-lintRange-error": {
              backgroundColor: "color-mix(in srgb, var(--destructive, #dc2626) 18%, transparent)",
            },
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) latest.current.onChange(update.state.doc.toString());
          }),
        ],
      }),
    });
    view.current = editor;
    return () => editor.destroy();
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- the editor owns its document after mount
  }, []);

  useEffect(() => {
    view.current?.dispatch({ effects: theme.current.reconfigure(dark ? oneDark : []) });
  }, [dark]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || editor.state.doc.toString() === value) return;
    editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert: value } });
  }, [value]);

  useEffect(() => {
    const editor = view.current;
    if (editor === null || typescript) return;
    const length = editor.state.doc.length;
    editor.dispatch(
      setDiagnostics(
        editor.state,
        diagnostics.map((d) => ({
          ...d,
          from: Math.min(d.from, length),
          to: Math.min(d.to, length),
        })),
      ),
    );
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- `typescript` never changes after mount
  }, [diagnostics]);

  return (
    <div
      ref={host}
      className="fr-frame astw:overflow-hidden astw:rounded-md astw:border"
      data-invalid={invalid}
      style={{ height: "100%" }}
    />
  );
}
