export type IdPServiceConfig = {
  authorization: "insecure" | "loggedIn"; // FIXME: string | () => boolean?
  clients: string[];
};
export type IdPServiceInput = {
  [namespace: string]: IdPServiceConfig;
};
