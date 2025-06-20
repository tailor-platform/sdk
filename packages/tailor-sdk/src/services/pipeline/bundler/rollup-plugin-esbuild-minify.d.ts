declare module "rollup-plugin-esbuild-minify" {
  import { Plugin } from "rollup";

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  export function minify(options?: any): Plugin;
}
