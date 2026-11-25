import { logger } from "@tailor-platform/sdk/cli";
import open from "open";

const FAILED = "Failed to open browser automatically. Please open the URL above manually.";

export async function openBrowser(url: string): Promise<void> {
  try {
    const launcher = await open(url);
    if (!launcher) return;
    if (launcher.exitCode) logger.warn(FAILED);
    else
      launcher.once("exit", (code) => {
        if (code) logger.warn(FAILED);
      });
  } catch {
    logger.warn(FAILED);
  }
}
