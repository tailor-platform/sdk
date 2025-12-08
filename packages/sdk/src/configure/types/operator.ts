export const OperationType = {
  FUNCTION: 2,
  GRAPHQL: 3,
  SQL: 4,
} as const;

export type OperationType = (typeof OperationType)[keyof typeof OperationType];
