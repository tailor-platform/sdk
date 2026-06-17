import * as file from "@tailor-platform/sdk/runtime/file";
import type {
  FileUploadOptions,
  FileUploadResponse,
  FileMetadata,
  FileDownloadStreamResponse,
} from "@tailor-platform/sdk/runtime/file";

export interface TypeWithFiles {
  SalesOrder: {
    fields: "receipt" | "form";
  };
  User: {
    fields: "avatar";
  };
  Event: {
    fields: "screenshot";
  };
}

const namespaces: Record<keyof TypeWithFiles, string> = {
  SalesOrder: "tailordb",
  User: "tailordb",
  Event: "analyticsdb",
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

export async function downloadFileStream<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<FileDownloadStreamResponse> {
  return await file.downloadStream(namespaces[type], type, field, recordId);
}
