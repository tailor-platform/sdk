import { Code, ConnectError } from "@connectrpc/connect";
import * as path from "pathe";
import { describe, expect, test } from "vitest";
import { z } from "zod";
import { getErrorDiagnostics, withErrorDiagnostics } from "./error-diagnostics";
import { errorToJson } from "./error-json";
import {
  atUserModule,
  configInvalidError,
  definitionExportError,
  definitionInvalidError,
  syntaxInvalidError,
} from "./validation-errors";

describe("error factories", () => {
  const file = path.join(process.cwd(), "resolvers/add.ts");
  const { error: zodError } = z.strictObject({ name: z.string() }).safeParse({});
  if (!zodError) throw new Error("expected a validation error");

  test.each([
    [
      "configInvalidError",
      configInvalidError({
        file,
        exportName: "default",
        subject: "Tailor config",
        error: zodError,
      }),
      "Invalid Tailor config:\n",
    ],
    [
      "definitionInvalidError",
      definitionInvalidError({ kind: "resolver", file, exportName: "add", error: zodError }),
      "Invalid resolver `add`:\n",
    ],
    [
      "definitionExportError",
      definitionExportError({ kind: "resolver", file, exportName: "default" }),
      "Resolver must not be the default export.",
    ],
  ])("%s leaves the file to the error's location", (_, error, message) => {
    expect(error.message.startsWith(message)).toBe(true);
    expect(error.message).not.toContain("resolvers/add.ts");
    expect(getErrorDiagnostics(error).location).toEqual({ file });
  });

  test("syntaxInvalidError leaves the file and line to the error's location", () => {
    const error = syntaxInvalidError({
      code: "InvalidSyntax",
      message: "Expression expected",
      filename: file,
      startLine: 3,
    });

    expect(error?.message).toBe("Invalid syntax: Expression expected");
    expect(error && getErrorDiagnostics(error).location).toEqual({ file, line: 3 });
  });
});

describe("atUserModule", () => {
  const file = path.join(process.cwd(), "tailordb/item.ts");

  test("locates an error at the module without changing it", () => {
    const cause = new Error("disk is full");
    const error = new Error("item table is broken", { cause });
    const { stack } = error;

    expect(atUserModule(error, file)).toBe(error);
    expect(error).toMatchObject({ message: "item table is broken", cause, stack });
    expect(getErrorDiagnostics(error).location).toEqual({ file });
  });

  test("keeps the code and the module of an RPC error in its JSON envelope", () => {
    const error = atUserModule(new ConnectError("token expired", Code.Unauthenticated), file);

    expect(errorToJson(error).error).toMatchObject({
      code: "RPC_UNAUTHENTICATED",
      message: "tailordb/item.ts: [unauthenticated] token expired",
    });
  });

  test("keeps the other diagnostics of the error", () => {
    const error = withErrorDiagnostics(new Error("bad"), {
      code: "PLUGIN_FAILED",
      suggestion: "Fix the plugin.",
    });

    atUserModule(error, file);

    expect(getErrorDiagnostics(error)).toEqual({
      code: "PLUGIN_FAILED",
      suggestion: "Fix the plugin.",
      location: { file },
    });
  });

  test("keeps the location of an error located at another source", () => {
    const location = { file: path.join(process.cwd(), "helpers.ts"), line: 2 };
    const error = withErrorDiagnostics(new Error("bad"), { location });

    expect(atUserModule(error, file)).toBe(error);
    expect(getErrorDiagnostics(error).location).toEqual(location);
  });

  test("returns a thrown non-error value as-is", () => {
    expect(atUserModule("broken", file)).toBe("broken");
  });
});
