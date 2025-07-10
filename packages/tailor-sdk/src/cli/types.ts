import type { ArgsDef } from "citty";

export type CliOption<T> = {
  [K in keyof T]-?: T[K] extends boolean | undefined
    ? {
        type: "boolean";
        description: string;
        alias?: string;
        default?: boolean;
      }
    : T[K] extends string | undefined
      ? {
          type: "string";
          description: string;
          alias?: string;
          default?: string;
        }
      : T[K] extends number | undefined
        ? {
            type: "number";
            description: string;
            alias?: string;
            default?: number;
          }
        : never;
} & ArgsDef;
