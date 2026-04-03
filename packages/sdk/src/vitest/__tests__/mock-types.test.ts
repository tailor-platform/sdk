/**
 * Type-level tests to verify mock implementations match `@tailor-platform/function-types`.
 *
 * These tests use expectTypeOf (compile-time checks) to ensure mock types
 * stay in sync with the platform's type definitions. If the platform types
 * change, these tests will fail at typecheck time.
 */
import { afterAll, beforeAll, describe, expectTypeOf, test } from "vitest";
import { injectMocks, cleanupMocks } from "../mock";

// Inject mocks so globalThis has the mock types
beforeAll(() => injectMocks(globalThis));
afterAll(() => cleanupMocks(globalThis));

describe("mock types match @tailor-platform/function-types", () => {
  describe("tailor.secretmanager", () => {
    test("getSecrets", () => {
      expectTypeOf(tailor.secretmanager.getSecrets).toEqualTypeOf<
        typeof tailor.secretmanager.getSecrets
      >();
      // Verify return type: Promise<Partial<Record<T[number], string>>>
      expectTypeOf(tailor.secretmanager.getSecrets("vault", ["a", "b"] as const)).toEqualTypeOf<
        Promise<Partial<Record<"a" | "b", string>>>
      >();
    });

    test("getSecret", () => {
      expectTypeOf(tailor.secretmanager.getSecret).toEqualTypeOf<
        typeof tailor.secretmanager.getSecret
      >();
      expectTypeOf(tailor.secretmanager.getSecret("vault", "name")).toEqualTypeOf<
        Promise<string | undefined>
      >();
    });
  });

  describe("tailor.authconnection", () => {
    test("getConnectionToken", () => {
      expectTypeOf(tailor.authconnection.getConnectionToken).toEqualTypeOf<
        typeof tailor.authconnection.getConnectionToken
      >();
    });
  });

  describe("tailor.workflow", () => {
    test("triggerJobFunction", () => {
      expectTypeOf(tailor.workflow.triggerJobFunction).toEqualTypeOf<
        typeof tailor.workflow.triggerJobFunction
      >();
    });

    test("triggerWorkflow", () => {
      expectTypeOf(tailor.workflow.triggerWorkflow).toEqualTypeOf<
        typeof tailor.workflow.triggerWorkflow
      >();
      expectTypeOf(tailor.workflow.triggerWorkflow("wf", {})).toEqualTypeOf<Promise<string>>();
    });
  });

  describe("tailor.idp", () => {
    test("Client constructor", () => {
      expectTypeOf(tailor.idp.Client).toEqualTypeOf<typeof tailor.idp.Client>();
    });

    test("Client methods", () => {
      const client = new tailor.idp.Client({ namespace: "test" });
      expectTypeOf(client.users).toEqualTypeOf<typeof client.users>();
      expectTypeOf(client.user).toEqualTypeOf<typeof client.user>();
      expectTypeOf(client.userByName).toEqualTypeOf<typeof client.userByName>();
      expectTypeOf(client.createUser).toEqualTypeOf<typeof client.createUser>();
      expectTypeOf(client.updateUser).toEqualTypeOf<typeof client.updateUser>();
      expectTypeOf(client.deleteUser).toEqualTypeOf<typeof client.deleteUser>();
      expectTypeOf(client.sendPasswordResetEmail).toEqualTypeOf<
        typeof client.sendPasswordResetEmail
      >();
    });
  });

  describe("tailor.iconv", () => {
    test("convert", () => {
      expectTypeOf(tailor.iconv.convert).toEqualTypeOf<typeof tailor.iconv.convert>();
    });

    test("convertBuffer", () => {
      expectTypeOf(tailor.iconv.convertBuffer).toEqualTypeOf<typeof tailor.iconv.convertBuffer>();
    });

    test("decode", () => {
      expectTypeOf(tailor.iconv.decode).toEqualTypeOf<typeof tailor.iconv.decode>();
    });

    test("encode", () => {
      expectTypeOf(tailor.iconv.encode).toEqualTypeOf<typeof tailor.iconv.encode>();
    });

    test("encodings", () => {
      expectTypeOf(tailor.iconv.encodings).toEqualTypeOf<typeof tailor.iconv.encodings>();
    });

    test("Iconv class", () => {
      expectTypeOf(tailor.iconv.Iconv).toEqualTypeOf<typeof tailor.iconv.Iconv>();
    });
  });

  describe("tailordb.Client", () => {
    test("constructor and methods", () => {
      expectTypeOf(tailordb.Client).toEqualTypeOf<typeof tailordb.Client>();
      const client = new tailordb.Client({ namespace: "test" });
      expectTypeOf(client.connect).toEqualTypeOf<typeof client.connect>();
      expectTypeOf(client.end).toEqualTypeOf<typeof client.end>();
      expectTypeOf(client.queryObject).toEqualTypeOf<typeof client.queryObject>();
    });
  });

  describe("tailordb.file", () => {
    test("upload", () => {
      expectTypeOf(tailordb.file.upload).toEqualTypeOf<typeof tailordb.file.upload>();
    });

    test("download", () => {
      expectTypeOf(tailordb.file.download).toEqualTypeOf<typeof tailordb.file.download>();
    });

    test("downloadAsBase64", () => {
      expectTypeOf(tailordb.file.downloadAsBase64).toEqualTypeOf<
        typeof tailordb.file.downloadAsBase64
      >();
    });

    test("delete", () => {
      expectTypeOf(tailordb.file.delete).toEqualTypeOf<typeof tailordb.file.delete>();
    });

    test("getMetadata", () => {
      expectTypeOf(tailordb.file.getMetadata).toEqualTypeOf<typeof tailordb.file.getMetadata>();
    });

    test("openDownloadStream", () => {
      expectTypeOf(tailordb.file.openDownloadStream).toEqualTypeOf<
        typeof tailordb.file.openDownloadStream
      >();
    });
  });

  describe("error classes", () => {
    test("TailorDBFileError", () => {
      expectTypeOf(TailorDBFileError).toEqualTypeOf<typeof TailorDBFileError>();
    });
  });
});
