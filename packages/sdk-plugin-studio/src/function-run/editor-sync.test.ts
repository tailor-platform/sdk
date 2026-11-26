import { EditorState } from "@codemirror/state";
import { describe, expect, test } from "vitest";
import { changedByEditor, fromProps } from "./editor-sync";

function update(annotated: boolean) {
  const state = EditorState.create({ doc: "old" });
  const transaction = state.update({
    changes: { from: 0, to: 3, insert: "new" },
    ...(annotated ? { annotations: fromProps.of(true) } : {}),
  });
  return { docChanged: transaction.docChanged, transactions: [transaction] };
}

describe("changedByEditor", () => {
  test("is true for a change the user typed", () => {
    expect(changedByEditor(update(false))).toBe(true);
  });

  test("is false for a change that only copies the value the page holds into the editor", () => {
    expect(changedByEditor(update(true))).toBe(false);
  });

  test("is false when the document did not change", () => {
    const state = EditorState.create({ doc: "same" });
    const transaction = state.update({});

    expect(changedByEditor({ docChanged: false, transactions: [transaction] })).toBe(false);
  });
});
