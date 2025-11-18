import multiline from "multiline-ts";
import type { FileUtilMetadata } from "./types";
import type { ParsedTailorDBType } from "@/parser/service/tailordb/types";

/**
 * Processor that collects file fields and generates TypeWithFiles interface.
 */
export class FileProcessor {
  static async processType(
    type: ParsedTailorDBType,
  ): Promise<FileUtilMetadata> {
    const fileFields: string[] = [];

    if (type.files) {
      for (const fileFieldName of Object.keys(type.files)) {
        fileFields.push(fileFieldName);
      }
    }

    return {
      name: type.name,
      fileFields,
    };
  }

  static async generateFileUtils(
    types: Record<string, FileUtilMetadata>,
    namespace: string,
  ): Promise<string> {
    const typesWithFiles = Object.values(types).filter(
      (t) => t.fileFields.length > 0,
    );

    if (typesWithFiles.length === 0) {
      return "";
    }

    const interfaceFields = typesWithFiles
      .map((type) => {
        const fieldNamesUnion = type.fileFields
          .map((field) => `"${field}"`)
          .join(" | ");
        return `  ${type.name}: {\n    fields: ${fieldNamesUnion};\n  };`;
      })
      .join("\n");

    const interfaceDefinition =
      multiline /* ts */ `
      export interface TypeWithFiles {
      ${interfaceFields}
      }
    ` + "\n";

    const namespaceEntries = typesWithFiles
      .map((type) => `  ${type.name}: "${namespace}"`)
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
        return await tailordb.file.download(namespaces[type], type, field, recordId);
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
        return await tailordb.file.upload(namespaces[type], type, field, recordId, data, options);
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
        return await tailordb.file.delete(namespaces[type], type, field, recordId);
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
        return await tailordb.file.getMetadata(namespaces[type], type, field, recordId);
      }
    ` + "\n";

    // Generate openFileDownloadStream helper function
    const openDownloadStreamFunction =
      multiline /* ts */ `
      export async function openFileDownloadStream<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ): Promise<FileStreamIterator> {
        return await tailordb.file.openDownloadStream(namespaces[type], type, field, recordId);
      }
    ` + "\n";

    return (
      interfaceDefinition +
      "\n" +
      namespacesDefinition +
      "\n" +
      downloadFunction +
      "\n" +
      uploadFunction +
      "\n" +
      deleteFunction +
      "\n" +
      getMetadataFunction +
      "\n" +
      openDownloadStreamFunction
    );
  }

  static generateUnifiedFileUtils(
    namespaceData: { namespace: string; types: FileUtilMetadata[] }[],
  ): string {
    if (namespaceData.length === 0) {
      return "";
    }

    // Collect all types with their namespace
    const typeNamespaceMap = new Map<string, string>();
    const typeFieldsMap = new Map<string, string[]>();

    for (const { namespace, types } of namespaceData) {
      for (const type of types) {
        typeNamespaceMap.set(type.name, namespace);
        typeFieldsMap.set(type.name, type.fileFields);
      }
    }

    if (typeNamespaceMap.size === 0) {
      return "";
    }

    // Generate interface fields
    const interfaceFields = Array.from(typeFieldsMap.entries())
      .map(([typeName, fields]) => {
        const fieldNamesUnion = fields.map((field) => `"${field}"`).join(" | ");
        return `  ${typeName}: {\n    fields: ${fieldNamesUnion};\n  };`;
      })
      .join("\n");

    const interfaceDefinition =
      multiline /* ts */ `
      export interface TypeWithFiles {
      ${interfaceFields}
      }
    ` + "\n";

    // Generate namespaces object
    const namespaceEntries = Array.from(typeNamespaceMap.entries())
      .map(([typeName, namespace]) => `  ${typeName}: "${namespace}"`)
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
        return await tailordb.file.download(namespaces[type], type, field, recordId);
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
        return await tailordb.file.upload(namespaces[type], type, field, recordId, data, options);
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
        return await tailordb.file.delete(namespaces[type], type, field, recordId);
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
        return await tailordb.file.getMetadata(namespaces[type], type, field, recordId);
      }
    ` + "\n";

    // Generate openFileDownloadStream helper function
    const openDownloadStreamFunction =
      multiline /* ts */ `
      export async function openFileDownloadStream<T extends keyof TypeWithFiles>(
        type: T,
        field: TypeWithFiles[T]["fields"],
        recordId: string,
      ): Promise<FileStreamIterator> {
        return await tailordb.file.openDownloadStream(namespaces[type], type, field, recordId);
      }
    ` + "\n";

    return (
      interfaceDefinition +
      "\n" +
      namespacesDefinition +
      "\n" +
      downloadFunction +
      "\n" +
      uploadFunction +
      "\n" +
      deleteFunction +
      "\n" +
      getMetadataFunction +
      "\n" +
      openDownloadStreamFunction
    );
  }
}
