declare module "humanize-duration" {
  export interface HumanizeDurationOptions {
    language?: string;
    delimiter?: string;
    spacer?: string;
    conjunction?: string;
    serialComma?: boolean;
    units?: string[];
    largest?: number;
    round?: boolean;
    decimal?: string;
    fallbacks?: string[];
  }

  export type HumanizeDuration = (
    ms: number,
    options?: HumanizeDurationOptions,
  ) => string;

  const humanizeDuration: HumanizeDuration;
  export default humanizeDuration;
}
