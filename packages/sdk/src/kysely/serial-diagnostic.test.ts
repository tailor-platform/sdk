import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ts from "typescript";
import { afterAll, describe, expect, test } from "vitest";

// A wide DB type makes tsc truncate the `values()`/`set()` parameter type, which
// elides `TypeLevelError`'s message argument. Only the rendered diagnostic shows
// that: a structural type assertion passes whether or not the marker is aliased.

const SDK_ROOT = join(import.meta.dirname, "..", "..");

const tempDirs: string[] = [];

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function diagnosticsFor(source: string): string[] {
  const dir = mkdtempSync(join(tmpdir(), "tailor-serial-diagnostic-"));
  tempDirs.push(dir);
  const fileName = join(dir, "case.ts");
  writeFileSync(fileName, source);

  const program = ts.createProgram({
    rootNames: [fileName],
    options: {
      strict: true,
      skipLibCheck: true,
      noEmit: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  });

  return ts
    .getPreEmitDiagnostics(program)
    .filter((diagnostic) => diagnostic.file?.fileName === fileName)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
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
  });
});
