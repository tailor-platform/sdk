export const queryEngines = ["sql", "gql"] as const;

export type QueryEngine = (typeof queryEngines)[number];
