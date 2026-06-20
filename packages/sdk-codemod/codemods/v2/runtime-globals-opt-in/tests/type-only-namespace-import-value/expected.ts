import type * as tailor from "pkg";
import type tailordb = require("other");
import "@tailor-platform/sdk/runtime/globals";

const Client = tailor.idp.Client;
const Query = tailordb.Query;

export { Client, Query };
