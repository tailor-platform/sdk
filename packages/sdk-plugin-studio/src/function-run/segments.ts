import { tokenize, type Tokenizer } from "@enlumine/core";

export interface Segment {
  kind: string;
  text: string;
}

export function segments(source: string, tokenizer: Tokenizer | null): Segment[] {
  return tokenize(source, tokenizer).map(({ kind, start, end }) => ({
    kind,
    text: source.slice(start, end),
  }));
}
