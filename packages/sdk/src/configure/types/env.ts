// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface Env { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface Env {}

/** Represents environment variables in the Tailor platform. */
export type TailorEnv = keyof Env extends never ? Record<string, string> : Env;
