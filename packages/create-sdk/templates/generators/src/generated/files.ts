import * as file from "@tailor-platform/sdk/runtime/file";
import type {
  FileUploadOptions,
  FileUploadResponse,
  FileMetadata,
  FileStreamIterator,
} from "@tailor-platform/sdk/runtime/file";

export interface TypeWithFiles {
  Product: {
    fields: "image";
  };
}

const namespaces: Record<keyof TypeWithFiles, string> = {
  Product: "main-db",
};

export async function downloadFile<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
) {
  return await file.download(namespaces[type], type, field, recordId);
}

export async function uploadFile<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
  data: string | ArrayBuffer | Uint8Array<ArrayBufferLike> | number[],
  options?: FileUploadOptions,
): Promise<FileUploadResponse> {
  return await file.upload(namespaces[type], type, field, recordId, data, options);
}

export async function deleteFile<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<void> {
  return await file.delete(namespaces[type], type, field, recordId);
}

export async function getFileMetadata<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<FileMetadata> {
  return await file.getMetadata(namespaces[type], type, field, recordId);
}

export async function openFileDownloadStream<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<FileStreamIterator> {
  return await file.openDownloadStream(namespaces[type], type, field, recordId);
}
