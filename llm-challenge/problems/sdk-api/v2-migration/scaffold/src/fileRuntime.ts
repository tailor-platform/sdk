import { file } from "@tailor-platform/sdk/runtime";

export async function readContract(recordId: string): Promise<number> {
  const stream = await file.openDownloadStream("tailordb", "Customer", "contract", recordId);
  let total = 0;
  try {
    for await (const item of stream) {
      if (item.type === "chunk") {
        total += item.data.byteLength;
      }
    }
  } finally {
    await stream.close();
  }
  return total;
}
