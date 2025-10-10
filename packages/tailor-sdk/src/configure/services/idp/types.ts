type IdPServiceConfig = {
  authorization: "insecure" | "loggedIn" | { cel: string };
  clients: string[];
};
export type IdPServiceInput = {
  [namespace: string]: IdPServiceConfig;
};
