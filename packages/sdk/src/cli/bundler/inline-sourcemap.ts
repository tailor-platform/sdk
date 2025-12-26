// NOTE(haru): Enable inline sourcemaps to preserve original source locations in error stack traces for bundled functions
// This flag will become unnecessary once function registry is implemented, which will resolve script size issues
export const enableInlineSourcemap: boolean = process.env.TAILOR_ENABLE_INLINE_SOURCEMAP === "true";
