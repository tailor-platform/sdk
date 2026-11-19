import { javascript } from "@codemirror/lang-javascript";
import { Compartment, EditorState } from "@codemirror/state";
import { oneDark } from "@codemirror/theme-one-dark";
import { EditorView } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { useEffect, useRef } from "react";

interface EditorProps {
  value: string;
  onChange: (value: string) => void;
  dark: boolean;
}

export function Editor({ value, onChange, dark }: EditorProps) {
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
          javascript({ typescript: true }),
          theme.current.of(latest.current.dark ? oneDark : []),
          EditorView.theme({
            "&": { fontSize: "0.8125rem", height: "100%" },
            ".cm-scroller": { overflow: "auto", fontFamily: "ui-monospace, monospace" },
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

  return (
    <div
      ref={host}
      className="astw:overflow-hidden astw:rounded-md astw:border"
      style={{ height: "100%" }}
    />
  );
}
