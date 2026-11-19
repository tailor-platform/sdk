import { base64Decode } from "@bufbuild/protobuf/wire";
import { Code, ConnectError } from "@connectrpc/connect";
import type { ApplicationLabelRejection } from "../application";

// `buf.validate.Violations` detail of a SetMetadata the platform rejected for holding 21 labels.
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
    value: base64Decode(capturedViolations),
  });
  return error;
}

/**
 * Build an application whose labels the platform rejected for their count.
 * @param name - Application name
 * @param sdkLabelsInPlace - Whether the SDK's own labels are stored
 * @returns Rejection as `applyApplication` reports it
 */
export function applicationLabelRejection(
  name: string,
  sdkLabelsInPlace = true,
): ApplicationLabelRejection {
  return {
    name,
    violation: "map must be at most 20 entries",
    sdkLabelsInPlace,
    unwrittenMetadata: ["key-0"],
    otherLabels: [],
  };
}
