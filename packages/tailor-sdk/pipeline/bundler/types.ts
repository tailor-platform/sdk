export interface Step {
  type: "fn" | "sql" | "gql";
  name: string;
  fn: Function;
}
