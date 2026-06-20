import tailor = require("pkg");
import tailordb = require("other");

const client = tailor.idp.Client;
type Rows<T> = tailordb.QueryResult<T>;

export { client };
export type { Rows };
