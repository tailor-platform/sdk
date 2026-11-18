import { logger } from "@tailor-platform/sdk/cli";
import open from "open";

export async function openBrowser(url: string): Promise<void> {
  try {
    await open(url);
  } catch {
    logger.warn("Failed to open browser automatically. Please open the URL above manually.");
  }
}
