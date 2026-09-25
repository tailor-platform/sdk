import { spawn } from "node:child_process";

const DEFAULT_EDITOR = "editor";

function normalizeEditorCommand(editor: string | undefined): string | undefined {
  const normalized = editor?.trim();
  return normalized && normalized.length > 0 ? normalized : undefined;
}

/**
 * Resolve an editor command only from explicit environment variables.
 * @returns Configured editor command, if any
 */
export function getConfiguredEditorCommand(): string | undefined {
  return normalizeEditorCommand(process.env.VISUAL) ?? normalizeEditorCommand(process.env.EDITOR);
}

/**
 * Resolve the editor command used for interactive file editing.
 * @returns Configured editor command or the system default fallback
 */
export function getEditorCommand(): string {
  return getConfiguredEditorCommand() ?? DEFAULT_EDITOR;
}

function parseEditorCommand(editor: string): {
  command: string;
  args: string[];
} {
  const [command, ...args] = editor.trim().split(/\s+/);

  if (!command) {
    throw new Error("Editor command is empty.");
  }

  return {
    command,
    args,
  };
}

/**
 * Open a file in the resolved editor and wait for the process to exit.
 * @param filePath - File path to open
 * @param editor - Editor command string
 * @returns Whether an editor process was launched
 */
export async function openInEditor(
  filePath: string,
  editor = getEditorCommand(),
): Promise<boolean> {
  const { command, args } = parseEditorCommand(editor);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(command, [...args, filePath], {
      stdio: "inherit",
      detached: false,
    });

    child.once("error", (error) => reject(error));
    child.once("close", (code) => {
      if (code == null || code === 0) {
        resolve();
        return;
      }
      reject(new Error(`Editor exited with code ${code}.`));
    });
  });

  return true;
}

/**
 * Open a file only when an editor is explicitly configured in the environment.
 * @param filePath - File path to open
 * @returns Whether an editor process was launched
 */
export async function openInConfiguredEditor(filePath: string): Promise<boolean> {
  const editor = getConfiguredEditorCommand();
  if (!editor) {
    return false;
  }

  return await openInEditor(filePath, editor);
}
