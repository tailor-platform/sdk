import multiline from "#/utils/multiline";
import type { FileUtilMetadata } from "./types";

/**
 * Generate unified file utility functions from collected metadata.
 * @param namespaceData - Namespace data with file utility metadata
 * @returns Generated file utility code
 */
export function generateUnifiedFileUtils(
  namespaceData: { namespace: string; types: FileUtilMetadata[] }[],
): string {
  if (namespaceData.length === 0) {
    return "";
  }

  // Collect all tables with their namespace
  const tableNamespaceMap = new Map<string, string>();
  const typeFieldsMap = new Map<string, string[]>();

  for (const { namespace, types } of namespaceData) {
    for (const type of types) {
      tableNamespaceMap.set(type.name, namespace);
      typeFieldsMap.set(type.name, type.fileFields);
    }
  }

  if (tableNamespaceMap.size === 0) {
    return "";
  }

  // Generate interface fields
  const interfaceFields = Array.from(typeFieldsMap.entries())
    .map(([tableName, fields]) => {
      const fieldNamesUnion = fields.map((field) => `"${field}"`).join(" | ");
      return `  ${tableName}: {\n    fields: ${fieldNamesUnion};\n  };`;
    })
    .join("\n");

  const importStatement =
    multiline /* ts */ `
      import { file } from "@tailor-platform/sdk/runtime/file";
      import type {
        FileUploadOptions,
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

  // Generate namespaces object
  const namespaceEntries = Array.from(tableNamespaceMap.entries())
    .map(([tableName, namespace]) => `  ${tableName}: "${namespace}"`)
    .join(",\n");

  const namespacesDefinition =
    multiline /* ts */ `
      const namespaces: Record<keyof TypeWithFiles, string> = {
      ${namespaceEntries},
      };
    ` + "\n";

  // Generate downloadFile helper function
  const downloadFunction =
    multiline /* ts */ `
      export async function downloadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ) {
        return await file.download(namespaces[type], type, field, recordId);
      }
    ` + "\n";

  // Generate uploadFile helper function
  const uploadFunction =
    multiline /* ts */ `
      export async function uploadFile<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
        data: string | ArrayBuffer | Uint8Array<ArrayBufferLike> | number[],
        options?: FileUploadOptions,
      ): Promise<FileUploadResponse> {
        return await file.upload(namespaces[type], type, field, recordId, data, options);
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
        return await file.delete(namespaces[type], type, field, recordId);
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
        return await file.getMetadata(namespaces[type], type, field, recordId);
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
        return await file.downloadStream(namespaces[type], type, field, recordId);
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
