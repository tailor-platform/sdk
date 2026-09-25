import { transformAuthInvoker } from "../../auth-invoker-unwrap/scripts/transform";

export default function transform(source: string, filePath: string): string | null {
  return transformAuthInvoker(source, filePath, { renameOptionKeys: false });
}
