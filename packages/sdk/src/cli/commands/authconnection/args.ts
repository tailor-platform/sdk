import { arg } from "@politty/valibot";
import * as v from "valibot";

/**
 * Arguments for identifying an auth connection
 */
export const connectionNameArgs = {
  name: arg(v.string(), {
    alias: "n",
    description: "Auth connection name",
  }),
};
