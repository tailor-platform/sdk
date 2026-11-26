import { Annotation, type Transaction } from "@codemirror/state";

/** Marks a change that only copies the value the page holds into the editor. */
export const fromProps = Annotation.define<boolean>();

/**
 * Whether an editor update is something the user typed, not the editor catching up with the page.
 * @param update - The update the editor reports
 * @param update.docChanged - Whether the document changed
 * @param update.transactions - The transactions that made the update
 * @returns True when the user changed the document
 */
export function changedByEditor(update: {
  docChanged: boolean;
  transactions: readonly Transaction[];
}): boolean {
  return update.docChanged && !update.transactions.some((tr) => tr.annotation(fromProps) === true);
}
