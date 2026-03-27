import { renamePropertyAccess, renamePropertyInPattern } from "../../codemod-engine";
import { createRule } from "../../rule-helpers";

export const renameAuthAttributesRule = createRule(
  {
    id: "v2/rename-auth-attributes",
    name: "Rename auth attributes to map/uuidList",
    description:
      "Renames `attributes` to `map` and `attributeList` to `uuidList` in " +
      "defineAuth() config and context.user property access.",
    since: "1.0.0",
    until: "2.0.0",
  },
  (source) => {
    let result = source;
    let changed = false;

    // Pass 1: Config side - rename properties inside defineAuth() calls
    const p1a = renamePropertyInPattern(result, "defineAuth($$$ARGS)", "attributes", "map");
    if (p1a.count > 0 && p1a.output !== result) {
      result = p1a.output;
      changed = true;
    }

    const p1b = renamePropertyInPattern(result, "defineAuth($$$ARGS)", "attributeList", "uuidList");
    if (p1b.count > 0 && p1b.output !== result) {
      result = p1b.output;
      changed = true;
    }

    // Pass 2: Runtime side - rename property access on context.user
    const p2a = renamePropertyAccess(result, "$CTX.user", "attributes", "map");
    if (p2a.count > 0) {
      result = p2a.output;
      changed = true;
    }

    const p2b = renamePropertyAccess(result, "$CTX.user", "attributeList", "uuidList");
    if (p2b.count > 0) {
      result = p2b.output;
      changed = true;
    }

    return changed ? result : null;
  },
);
