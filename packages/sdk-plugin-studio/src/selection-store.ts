import * as fs from "node:fs";
import * as path from "pathe";
import type { SelectionStore } from "./workspace-context";

/**
 * The directory of the project the studio runs in: the one holding the config file the CLI found,
 * which is above the working directory when `tailor studio` runs from a subdirectory.
 * @param env - Environment the CLI started the plugin with
 * @param cwd - Working directory, used when the CLI passed no config file
 * @returns The project directory
 */
export function projectDirectory(env: NodeJS.ProcessEnv, cwd: string): string {
  return env.TAILOR_CONFIG_PATH ? path.dirname(env.TAILOR_CONFIG_PATH) : cwd;
}

/**
 * Remember the selected profile of a project under its `node_modules/.cache`, so the choice
 * survives restarts, port changes and browsers, and never leaks into another project.
 * @param projectDir - Directory of the project the studio runs in
 * @returns A store backed by `selection.json`
 */
export function createSelectionStore(projectDir: string): SelectionStore {
  const file = path.join(projectDir, "node_modules", ".cache", "tailor-studio", "selection.json");
  return {
    load: () => {
      try {
        const { profile } = JSON.parse(fs.readFileSync(file, "utf8")) as { profile?: unknown };
        return typeof profile === "string" ? profile : undefined;
      } catch {
        return undefined;
      }
    },
    save: (profile) => {
      try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, JSON.stringify(profile === null ? {} : { profile }));
      } catch {
        // Remembering is a convenience; a read-only project must not break selecting.
      }
    },
  };
}
