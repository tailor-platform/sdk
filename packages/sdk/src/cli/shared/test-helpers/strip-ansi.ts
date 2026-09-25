// eslint-disable-next-line no-control-regex -- ANSI escapes start with ESC (U+001B) by definition
const CSI_SEQUENCE = /\x1b\[[0-9;?]*[a-zA-Z]/g;

export function stripAnsi(value: string): string {
  return value.replace(CSI_SEQUENCE, "");
}
