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
