declare module "pkg" {
  import { tailor } from "dep";
  import * as tailordb from "dep";
}

const client = new tailor.idp.Client();
type Rows<Row> = tailordb.QueryResult<Row>;

export { client };
export type { Rows };
