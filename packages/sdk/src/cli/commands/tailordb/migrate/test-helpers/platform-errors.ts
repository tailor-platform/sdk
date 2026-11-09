import { base64Decode, BinaryWriter, WireType } from "@bufbuild/protobuf/wire";
import { Code, ConnectError } from "@connectrpc/connect";

export function preconditionFailureError(
  message: string,
  violationType: string,
  subject: string,
): ConnectError {
  const violation = new BinaryWriter()
    .tag(1, WireType.LengthDelimited)
    .string(violationType)
    .tag(2, WireType.LengthDelimited)
    .string(subject)
    .finish();
  const value = new BinaryWriter().tag(1, WireType.LengthDelimited).bytes(violation).finish();
  return Object.assign(new ConnectError(message, Code.FailedPrecondition), {
    details: [{ type: "google.rpc.PreconditionFailure", value }],
  });
}

export function requiredFieldNullValuesError(): ConnectError {
  return Object.assign(
    new ConnectError(
      'field "note" cannot be updated from non-required to required when records with null values exist',
      Code.FailedPrecondition,
    ),
    {
      details: [
        {
          type: "google.rpc.PreconditionFailure",
          value: base64Decode(
            "ClEKHlJFUVVJUkVEX0ZJRUxEX0hBU19OVUxMX1ZBTFVFUxIEbm90ZRopZmllbGQgIm5vdGUiIGhhcyByZWNvcmRzIHdpdGggbnVsbCB2YWx1ZXM",
          ),
        },
      ],
    },
  );
}
