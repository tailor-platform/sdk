import { ScalarType } from "@bufbuild/protobuf";
import type { DescEnum, DescField, DescMessage, DescMethodUnary } from "@bufbuild/protobuf";

export interface InspectFieldJson {
  name: string;
  protoName: string;
  type: string;
  fieldKind: string;
  repeated: boolean;
  enumValues?: string[];
  message?: { typeName: string; fields: InspectFieldJson[] } | undefined;
}

export interface InspectMethodJson {
  method: string;
  input: {
    typeName: string;
    fields: InspectFieldJson[];
  };
  output: {
    typeName: string;
  };
}

const SCALAR_LABEL: Partial<Record<number, string>> = {
  [ScalarType.DOUBLE]: "double",
  [ScalarType.FLOAT]: "float",
  [ScalarType.INT64]: "int64",
  [ScalarType.UINT64]: "uint64",
  [ScalarType.INT32]: "int32",
  [ScalarType.FIXED64]: "fixed64",
  [ScalarType.FIXED32]: "fixed32",
  [ScalarType.BOOL]: "bool",
  [ScalarType.STRING]: "string",
  [ScalarType.BYTES]: "bytes",
  [ScalarType.UINT32]: "uint32",
  [ScalarType.SFIXED32]: "sfixed32",
  [ScalarType.SFIXED64]: "sfixed64",
  [ScalarType.SINT32]: "sint32",
  [ScalarType.SINT64]: "sint64",
};

function shortName(typeName: string): string {
  const dot = typeName.lastIndexOf(".");
  return dot < 0 ? typeName : typeName.slice(dot + 1);
}

function scalarLabel(scalar: ScalarType): string {
  return SCALAR_LABEL[scalar] ?? `scalar(${scalar})`;
}

function enumLabel(enumDesc: DescEnum): string {
  return `enum ${shortName(enumDesc.typeName)}`;
}

export function describeFieldType(field: DescField): string {
  switch (field.fieldKind) {
    case "scalar":
      return field.scalar === ScalarType.STRING ? "string" : scalarLabel(field.scalar);
    case "enum":
      return enumLabel(field.enum);
    case "message":
      return shortName(field.message.typeName);
    case "list": {
      let inner: string;
      if (field.listKind === "scalar") {
        inner = field.scalar === ScalarType.STRING ? "string" : scalarLabel(field.scalar);
      } else if (field.listKind === "enum") {
        inner = enumLabel(field.enum);
      } else {
        inner = shortName(field.message.typeName);
      }
      return `repeated ${inner}`;
    }
    case "map": {
      const keyType = scalarLabel(field.mapKey);
      let valType: string;
      if (field.mapKind === "scalar") valType = scalarLabel(field.scalar);
      else if (field.mapKind === "enum") valType = enumLabel(field.enum);
      else valType = shortName(field.message.typeName);
      return `map<${keyType}, ${valType}>`;
    }
    default:
      return "<unknown>";
  }
}

function fieldToJson(field: DescField, depth: number): InspectFieldJson {
  const json: InspectFieldJson = {
    name: field.localName,
    protoName: field.name,
    type: describeFieldType(field),
    fieldKind: field.fieldKind,
    repeated: field.fieldKind === "list",
  };

  if (field.fieldKind === "enum") {
    json.enumValues = field.enum.values.map((v) => v.name);
  } else if (field.fieldKind === "list" && field.listKind === "enum") {
    json.enumValues = field.enum.values.map((v) => v.name);
  }

  if (depth > 0) {
    let nested: DescMessage | undefined;
    if (field.fieldKind === "message") nested = field.message;
    else if (field.fieldKind === "list" && field.listKind === "message") nested = field.message;
    if (nested) {
      json.message = {
        typeName: nested.typeName,
        fields: nested.fields.map((f) => fieldToJson(f, depth - 1)),
      };
    }
  }

  return json;
}

export function renderInspectJson(method: DescMethodUnary): InspectMethodJson {
  return {
    method: method.name,
    input: {
      typeName: method.input.typeName,
      fields: method.input.fields.map((f) => fieldToJson(f, 4)),
    },
    output: { typeName: method.output.typeName },
  };
}

function renderFieldText(field: DescField, depth: number, indent: string): string[] {
  const lines: string[] = [];
  const prefix = indent;
  lines.push(`${prefix}${field.localName}: ${describeFieldType(field)}`);

  if (field.fieldKind === "enum") {
    const values = field.enum.values.map((v) => v.name).join(", ");
    lines.push(`${prefix}  values: ${values}`);
  } else if (field.fieldKind === "list" && field.listKind === "enum") {
    const values = field.enum.values.map((v) => v.name).join(", ");
    lines.push(`${prefix}  values: ${values}`);
  }

  if (depth > 0) {
    let nested: DescMessage | undefined;
    if (field.fieldKind === "message") nested = field.message;
    else if (field.fieldKind === "list" && field.listKind === "message") nested = field.message;
    if (nested) {
      for (const sub of nested.fields) {
        lines.push(...renderFieldText(sub, depth - 1, `${indent}  `));
      }
    }
  }

  return lines;
}

export function renderInspectText(method: DescMethodUnary): string {
  const lines: string[] = [];
  lines.push(`${method.name}`);
  lines.push(`  request: ${method.input.typeName}`);
  for (const f of method.input.fields) {
    lines.push(...renderFieldText(f, 4, "    "));
  }
  lines.push(`  response: ${method.output.typeName}`);
  return lines.join("\n");
}
