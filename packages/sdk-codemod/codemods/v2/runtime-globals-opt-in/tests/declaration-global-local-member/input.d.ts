export {};

declare global {
  namespace tailordb {
    type Row = string;
  }
}

type Row = tailordb.Row;
