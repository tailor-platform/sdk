import { createResolver } from "@tailor-platform/sdk";
import type { TailorUser } from "./domain";

export type Props = {
  user: TailorUser;
};

export default createResolver({
  name: "n",
  operation: "query",
  output: { id: "string" } as never,
  body: () => null,
});
