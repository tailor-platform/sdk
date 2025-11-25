declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace TailorSDK {
    // eslint-disable-next-line @typescript-eslint/no-empty-object-type
    interface Env {}
  }
}

export type InferredEnv = keyof TailorSDK.Env extends never
  ? Record<string, string>
  : TailorSDK.Env;

/** Represents environment variables in the Tailor platform. */
export type TailorEnv = InferredEnv;
