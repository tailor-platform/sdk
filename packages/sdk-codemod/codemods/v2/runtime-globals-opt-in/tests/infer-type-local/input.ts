type Unwrap<T> = T extends Promise<infer tailor> ? tailor : never;
type ExtractDb<T> = T extends { db: infer tailordb } ? tailordb : never;

export type { ExtractDb, Unwrap };
