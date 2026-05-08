import { loadInventory } from "../src/variants/inventory.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";
import { parseCode } from "../src/checks/parse.ts";
import { checkHallucinations } from "../src/checks/halluc.ts";

const variantDist = resolveVariantPath("current");
const inv = await loadInventory(variantDist);

const snippets = [
  {
    name: "db.array(...)",
    code: `import { db } from "@tailor-platform/sdk";\nexport const u = db.type("U", { tags: db.array(db.string()) });`,
  },
  {
    name: "db.string().optional()",
    code: `import { db } from "@tailor-platform/sdk";\nexport const u = db.type("U", { name: db.string().optional() });`,
  },
  {
    name: "t.int().optional()",
    code: `import { t } from "@tailor-platform/sdk";\nconst x = t.int().optional();`,
  },
];

console.log("db members:", [...(inv.members.get("db") ?? [])]);
console.log("t members:", [...(inv.members.get("t") ?? [])]);
console.log();

for (const s of snippets) {
  const parsed = parseCode(s.code);
  const sigs = checkHallucinations(parsed.calls, parsed.imports, inv);
  console.log("=== " + s.name + " ===");
  console.log(
    "calls:",
    parsed.calls.map((c) => c.callee),
  );
  console.log("signals:", JSON.stringify(sigs));
  console.log();
}
