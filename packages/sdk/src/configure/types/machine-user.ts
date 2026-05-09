// Interface for module augmentation
// Users can extend via: declare module "@tailor-platform/sdk" { interface MachineUserNameRegistry { ... } }
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface MachineUserNameRegistry {}

/**
 * Machine user name.
 *
 * When `tailor.d.ts` is generated (via `tailor-sdk deploy`/`generate`), this is narrowed
 * to the union of defined machine user names. When no machine users are registered yet,
 * falls back to `string` to avoid blocking editing before the first generate run.
 */
export type MachineUserName = keyof MachineUserNameRegistry extends never
  ? string
  : keyof MachineUserNameRegistry & string;
