import { arg } from "politty";
import { z } from "zod";

/**
 * Arguments for identifying an auth connection
 */
export const connectionNameArgs = {
  name: arg(z.string(), {
    alias: "n",
    description: "Auth connection name",
  }),
};
