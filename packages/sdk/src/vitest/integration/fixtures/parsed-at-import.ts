import { t } from "../../../configure/types/type";

export const parsedAtImport = t.date().parse({ value: "2026-10-05", data: {}, invoker: null });

export const parsedDecimalAtImport = t.decimal().parse({ value: "1.5", data: {}, invoker: null });
