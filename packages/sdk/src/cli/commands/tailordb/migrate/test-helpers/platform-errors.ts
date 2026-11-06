import { Code, ConnectError } from "@connectrpc/connect";

export function requiredFieldNullValuesError(field: string): ConnectError {
  return Object.assign(
    new ConnectError(
      `field "${field}" cannot be updated from non-required to required when records with null values exist`,
      Code.FailedPrecondition,
    ),
    { details: [{ type: "google.rpc.PreconditionFailure", value: new Uint8Array() }] },
  );
}
