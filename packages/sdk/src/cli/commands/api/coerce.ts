import { ScalarType } from "@bufbuild/protobuf";

export type CoerceResult<T> = { ok: true; value: T } | { ok: false; error: string };

const INT32_MIN = -2_147_483_648;
const INT32_MAX = 2_147_483_647;
const UINT32_MAX = 4_294_967_295;
const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;
const UINT64_MAX = 2n ** 64n - 1n;

function parseStrictInt(raw: string): number | undefined {
  if (!/^-?\d+$/.test(raw)) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

export function coerceScalarValue(
  scalar: ScalarType,
  raw: string,
): CoerceResult<string | number | boolean> {
  switch (scalar) {
    case ScalarType.STRING:
    case ScalarType.BYTES:
      return { ok: true, value: raw };

    case ScalarType.BOOL: {
      const lower = raw.toLowerCase();
      if (lower === "true" || lower === "1") return { ok: true, value: true };
      if (lower === "false" || lower === "0") return { ok: true, value: false };
      return { ok: false, error: `expected boolean (true/false/1/0), got ${JSON.stringify(raw)}` };
    }

    case ScalarType.INT32:
    case ScalarType.SINT32:
    case ScalarType.SFIXED32: {
      const n = parseStrictInt(raw);
      if (n === undefined)
        return { ok: false, error: `expected integer, got ${JSON.stringify(raw)}` };
      if (n < INT32_MIN || n > INT32_MAX)
        return { ok: false, error: `value ${raw} is out of int32 range` };
      return { ok: true, value: n };
    }

    case ScalarType.UINT32:
    case ScalarType.FIXED32: {
      const n = parseStrictInt(raw);
      if (n === undefined)
        return { ok: false, error: `expected integer, got ${JSON.stringify(raw)}` };
      if (n < 0 || n > UINT32_MAX)
        return { ok: false, error: `value ${raw} is out of uint32 range` };
      return { ok: true, value: n };
    }

    case ScalarType.INT64:
    case ScalarType.UINT64:
    case ScalarType.SINT64:
    case ScalarType.FIXED64:
    case ScalarType.SFIXED64: {
      if (!/^-?\d+$/.test(raw))
        return { ok: false, error: `expected integer, got ${JSON.stringify(raw)}` };
      const isUnsigned = scalar === ScalarType.UINT64 || scalar === ScalarType.FIXED64;
      if (isUnsigned && raw.startsWith("-")) {
        return { ok: false, error: `value ${raw} is negative for unsigned 64-bit field` };
      }
      const big = BigInt(raw);
      if (isUnsigned) {
        if (big > UINT64_MAX) return { ok: false, error: `value ${raw} is out of uint64 range` };
      } else {
        if (big < INT64_MIN || big > INT64_MAX)
          return { ok: false, error: `value ${raw} is out of int64 range` };
      }
      return { ok: true, value: raw };
    }

    case ScalarType.FLOAT:
    case ScalarType.DOUBLE: {
      // Number("") and Number("  ") both yield 0; require a non-empty,
      // unpadded numeric literal so an empty `--field key=` rejects.
      if (!/^-?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/.test(raw))
        return { ok: false, error: `expected number, got ${JSON.stringify(raw)}` };
      const n = Number(raw);
      if (!Number.isFinite(n))
        return { ok: false, error: `expected number, got ${JSON.stringify(raw)}` };
      return { ok: true, value: n };
    }

    default:
      return { ok: false, error: `unsupported scalar type: ${scalar}` };
  }
}

export interface EnumDescriptorLike {
  values: ReadonlyArray<{ name: string; localName: string; number: number }>;
}

export function coerceEnumValue(enumDesc: EnumDescriptorLike, raw: string): CoerceResult<string> {
  const match = enumDesc.values.find((v) => v.name === raw || v.localName === raw);
  if (match) return { ok: true, value: match.name };
  const candidates = enumDesc.values.map((v) => v.name).join(", ");
  return {
    ok: false,
    error: `expected one of: ${candidates}; got ${JSON.stringify(raw)}`,
  };
}
