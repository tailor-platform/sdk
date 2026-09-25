import type { AttributeMap } from "@tailor-platform/sdk";

namespace Local {
  export interface AttributeMap {
    local: string;
  }

  export type LocalAttrs = AttributeMap;
}

type SdkAttrs = AttributeMap;
