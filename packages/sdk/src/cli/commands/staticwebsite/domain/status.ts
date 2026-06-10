import { CustomDomainStatus } from "@tailor-proto/tailor/v1/staticwebsite_resource_pb";

export const statusLabels: Record<CustomDomainStatus, string> = {
  [CustomDomainStatus.UNSPECIFIED]: "unspecified",
  [CustomDomainStatus.PENDING]: "pending",
  [CustomDomainStatus.VERIFYING]: "verifying",
  [CustomDomainStatus.CERT_ISSUED]: "cert_issued",
  [CustomDomainStatus.ACTIVE]: "active",
  [CustomDomainStatus.FAILED]: "failed",
};
