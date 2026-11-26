import multiline from "#/utils/multiline";
import { qualifiedTailorDBTypeName } from "#/utils/tailordb-type-names";
import type { FileUtilMetadata } from "./types";

/**
 * Generate unified file utility functions from collected metadata.
 * @param namespaceData - Namespace data with file utility metadata
 * @param sharedTypeNames - Table names several namespaces of the config define
 * @returns Generated file utility code
 */
export function generateUnifiedFileUtils(
  namespaceData: { namespace: string; types: FileUtilMetadata[] }[],
  sharedTypeNames: ReadonlySet<string> = new Set(),
): string {
  if (namespaceData.length === 0) {
    return "";
  }

  const tables = namespaceData.flatMap(({ namespace, types }) =>
    types.map((type) => ({
      key: qualifiedTailorDBTypeName(namespace, type.name, sharedTypeNames),
      namespace,
      typeName: type.name,
      fileFields: type.fileFields,
    })),
  );

  if (tables.length === 0) {
    return "";
  }

  const qualified = tables.some(({ key, typeName }) => key !== typeName);
  const propertyKey = (key: string) => (key.includes(".") ? JSON.stringify(key) : key);

  // Generate interface fields
  const interfaceFields = tables
    .map(({ key, fileFields }) => {
      const fieldNamesUnion = fileFields.map((field) => `"${field}"`).join(" | ");
      return `  ${propertyKey(key)}: {\n    fields: ${fieldNamesUnion};\n  };`;
    })
    .join("\n");

  const importStatement =
    multiline /* ts */ `
      import { file } from "@tailor-platform/sdk/runtime/file";
      import type {
        FileUploadOptions,
        FileUploadStringOptions,
        FileUploadBytes,
        FileUploadResponse,
        FileMetadata,
        FileDownloadStreamResponse,
      } from "@tailor-platform/sdk/runtime/file";
    ` + "\n";

  const interfaceDefinition =
    multiline /* ts */ `
      export interface TypeWithFiles {
      ${interfaceFields}
      }
    ` + "\n";

  // A key names the table's namespace when several namespaces define its name, so it is not the
  // table name the file API takes.
  const tableEntries = tables
    .map(({ key, namespace, typeName }) =>
      qualified
        ? `  ${propertyKey(key)}: { namespace: "${namespace}", type: "${typeName}" }`
        : `  ${key}: "${namespace}"`,
    )
    .join(",\n");

  const namespacesDefinition = qualified
    ? multiline /* ts */ `
        const tables: Record<keyof TypeWithFiles, { namespace: string; type: string }> = {
        ${tableEntries},
        };
      ` + "\n"
    : multiline /* ts */ `
        const namespaces: Record<keyof TypeWithFiles, string> = {
        ${tableEntries},
        };
      ` + "\n";
  const tableArgs = qualified
    ? "tables[type].namespace, tables[type].type"
    : "namespaces[type], type";

  // Generate downloadFile helper function
  const downloadFunction =
    multiline /* ts */ `
      export async function downloadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ) {
        return await file.download(${tableArgs}, field, recordId);
      }
    ` + "\n";

  // Generate uploadFile helper function
  const uploadFunction =
    multiline /* ts */ `
      export function uploadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
        data: FileUploadBytes,
        options?: FileUploadOptions,
      ): Promise<FileUploadResponse>;
      export function uploadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
        data: string | FileUploadBytes,
        options: FileUploadStringOptions,
      ): Promise<FileUploadResponse>;
      /**
       * @deprecated since 2.15.0 — pass encoding: "utf8" for text or "base64" for Base64 strings. codemod: v3/file-upload-encoding
       */
      export function uploadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
        data: string | FileUploadBytes,
        options?: FileUploadOptions,
      ): Promise<FileUploadResponse>;
      export async function uploadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
        data: string | FileUploadBytes,
        options?: FileUploadOptions,
      ): Promise<FileUploadResponse> {
        return await file.upload(${tableArgs}, field, recordId, data, options);
      }
    ` + "\n";

  // Generate deleteFile helper function
  const deleteFunction =
    multiline /* ts */ `
      export async function deleteFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ): Promise<void> {
        return await file.delete(${tableArgs}, field, recordId);
      }
    ` + "\n";

  // Generate getFileMetadata helper function
  const getMetadataFunction =
    multiline /* ts */ `
      export async function getFileMetadata<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ): Promise<FileMetadata> {
        return await file.getMetadata(${tableArgs}, field, recordId);
      }
    ` + "\n";

  // Generate downloadFileStream helper function
  const downloadStreamFunction =
    multiline /* ts */ `
      export async function downloadFileStream<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ): Promise<FileDownloadStreamResponse> {
        return await file.downloadStream(${tableArgs}, field, recordId);
      }
    ` + "\n";

  return [
    importStatement,
    interfaceDefinition,
    namespacesDefinition,
    downloadFunction,
    uploadFunction,
    deleteFunction,
    getMetadataFunction,
    downloadStreamFunction,
  ].join("\n");
}
