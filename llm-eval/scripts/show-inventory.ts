import { describeInventory, loadInventory } from "../src/variants/inventory.ts";
import { resolveVariantPath } from "../src/variants/resolve.ts";

async function main(): Promise<void> {
  const dist = resolveVariantPath("current");
  const inv = await loadInventory(dist);
  console.log(describeInventory(inv));
  console.log();
  console.log("Sample top-level exports (first 30):");
  console.log("  " + [...inv.topLevel].slice(0, 30).join(", "));
  console.log();
  console.log("Receivers with known members (top 10 by member count):");
  const sorted = [...inv.members.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 10);
  for (const [name, mems] of sorted) {
    console.log(
      `  ${name} (${mems.size}): ${[...mems].slice(0, 8).join(", ")}${mems.size > 8 ? ", ..." : ""}`,
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
