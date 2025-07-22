declare module "rollup-plugin-esbuild-minify" {
  import { Plugin } from "rollup";

  export function minify(options?: any): Plugin;
}
