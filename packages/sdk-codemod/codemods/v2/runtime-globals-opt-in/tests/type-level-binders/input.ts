type Box<tailor> = tailor;
type Indexed = { [tailordb: string]: unknown };
type Mapped<Source> = { [tailor in keyof Source]: Source[tailor] };

export type { Box, Indexed, Mapped };
