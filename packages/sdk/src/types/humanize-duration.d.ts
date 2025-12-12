// humanize-duration ships CommonJS-style typings (`export = humanizeDuration`).
// Our tsconfig does not enable `esModuleInterop`, but we use a default import.
// This module augmentation exposes the existing humanizeDuration export as a default
// so that `import humanizeDuration from "humanize-duration"` type-checks correctly.
declare module "humanize-duration" {
  export default humanizeDuration;
}
