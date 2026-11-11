import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ScriptTarget } from "typescript/ast";
import { ModuleKind, ModuleResolutionKind } from "typescript/sync";
import { afterAll, describe, expect, test } from "vitest";
import { createTypeChecker, flattenDiagnosticText } from "#/utils/test-helpers/type-check";

// A wide DB type makes tsc truncate the `values()`/`set()` parameter type, which
// elides `TypeLevelError`'s message argument. Only the rendered diagnostic shows
// that: a structural type assertion passes whether or not the marker is aliased.

const SDK_ROOT = join(import.meta.dirname, "..", "..");

const tempDirs: string[] = [];
const checker = createTypeChecker();

afterAll(() => {
  checker.close();
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function diagnosticsFor(source: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-serial-diagnostic-"));
  tempDirs.push(dir);
  const fileName = join(dir, "case.ts");
  writeFileSync(fileName, source);

  return checker
    .diagnostics([fileName], {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ScriptTarget.ES2022,
      module: ModuleKind.ESNext,
      moduleResolution: ModuleResolutionKind.Bundler,
    })
    .filter((diagnostic) => diagnostic.fileName === fileName)
    .map((diagnostic) => flattenDiagnosticText(diagnostic, " "));
}

const SERIAL_ASSIGNMENT_CASE = `
import type { ColumnType, Kysely, Serial } from "${join(SDK_ROOT, "src", "kysely", "index")}";

interface Invoice {
  id: ColumnType<string, string, string>;
  documentNumber: Serial<string>;
}

type NS = {
  default: {
    Customer: { id: string; name: string };
    Order: { id: string; total: number };
    Product: { id: string; sku: string };
    Payment: { id: string; amount: number };
    Shipment: { id: string; carrier: string };
    Address: { id: string; line1: string };
    Contact: { id: string; email: string };
    Warehouse: { id: string; code: string };
    Inventory: { id: string; qty: number };
    Supplier: { id: string; name: string };
    Category: { id: string; label: string };
    UserSetting: { id: string; theme: string };
    Invoice: Invoice;
  };
};

declare function getDB<N extends keyof NS>(ns: N): Kysely<NS[N]>;
const db = getDB("default");
db.insertInto("Invoice").values({ id: "1", documentNumber: "INV-001" });
db.updateTable("Invoice").set({ documentNumber: "INV-002" });
`;

describe("Serial diagnostics", () => {
  test("names the serial constraint in a truncated parameter type", () => {
    const messages = diagnosticsFor(SERIAL_ASSIGNMENT_CASE);

    expect(messages).toHaveLength(2);
    for (const message of messages) {
      expect(message).toContain("SerialColumnMustBeOmitted");
      expect(message).not.toContain("TypeLevelError<...>");
    }
  }, 15_000);
});
