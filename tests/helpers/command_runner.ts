import { spawn } from 'node:child_process';
import { styleText } from 'node:util';

export interface CommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * pnpm applyコマンドを指定された出力ディレクトリで実行する
 * @param outputDir 出力先ディレクトリのパス
 * @returns コマンドの実行結果
 */
export async function runApplyCommand(outputDir: string): Promise<CommandResult> {
  const args = ['apply', outputDir];
  console.log(styleText("cyan", `$ pnpm ${args.join(' ')}`));
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', args, {
      cwd: process.cwd(),
      stdio: 'pipe',
      shell: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });

    child.on('error', (error) => {
      reject(error);
    });

    // タイムアウト設定（30秒）
    setTimeout(() => {
      child.kill();
      reject(new Error('Command timeout after 30 seconds'));
    }, 30000);
  });
}

/**
 * 任意のコマンドを実行する汎用関数
 * @param command 実行するコマンド
 * @param args コマンドの引数
 * @param options 実行オプション
 * @returns コマンドの実行結果
 */
export async function runCommand(
  command: string,
  args: string[] = [],
  options: { cwd?: string; timeout?: number } = {}
): Promise<CommandResult> {
  const { cwd = process.cwd(), timeout = 30000 } = options;

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      stdio: 'pipe',
      shell: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    child.on('close', (code) => {
      resolve({
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim()
      });
    });

    child.on('error', (error) => {
      reject(error);
    });

    // タイムアウト設定
    setTimeout(() => {
      child.kill();
      reject(new Error(`Command timeout after ${timeout}ms`));
    }, timeout);
  });
}
