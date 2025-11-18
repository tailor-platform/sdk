export interface TypeWithFiles {
  SalesOrder: {
    fields: "receipt" | "form";
  };
  User: {
    fields: "avatar";
  };
}

const namespaces: Record<keyof TypeWithFiles, string> = {
  SalesOrder: "tailordb",
  User: "tailordb",
};

export async function downloadFile<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
) {
  return await tailordb.file.download(namespaces[type], type, field, recordId);
}

export async function uploadFile<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
  data: string | ArrayBuffer | Uint8Array<ArrayBufferLike> | number[],
  options?: FileUploadOptions,
): Promise<FileUploadResponse> {
  return await tailordb.file.upload(namespaces[type], type, field, recordId, data, options);
}

export async function deleteFile<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<void> {
  return await tailordb.file.delete(namespaces[type], type, field, recordId);
}

export async function getFileMetadata<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<FileMetadata> {
  return await tailordb.file.getMetadata(namespaces[type], type, field, recordId);
}

export async function openFileDownloadStream<T extends keyof TypeWithFiles>(
  type: T,
  field: TypeWithFiles[T]["fields"],
  recordId: string,
): Promise<FileStreamIterator> {
  return await tailordb.file.openDownloadStream(namespaces[type], type, field, recordId);
}
