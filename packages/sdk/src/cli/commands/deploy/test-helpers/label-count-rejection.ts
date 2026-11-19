import { Code, ConnectError } from "@connectrpc/connect";

// The `buf.validate.Violations` detail the platform returned for a SetMetadata with 21 labels.
const capturedViolations =
  "Cl0SDW1hcC5tYXhfcGFpcnMaHm1hcCBtdXN0IGJlIGF0IG1vc3QgMjAgZW50cmllcyoOCgwIAhIGbGFiZWxzGAsyHAoJCBMSA21hcBgLCg8IAhIJbWF4X3BhaXJzGAQ";

/**
 * Build the error the platform returns when a `SetMetadata` holds more labels than it allows.
 * @returns Rejection carrying the platform's violation detail
 */
export function labelCountRejection(): ConnectError {
  const error = new ConnectError(
    "validation error: labels: map must be at most 20 entries",
    Code.InvalidArgument,
  );
  error.details.push({
    type: "buf.validate.Violations",
    value: Buffer.from(capturedViolations, "base64"),
  });
  return error;
}
