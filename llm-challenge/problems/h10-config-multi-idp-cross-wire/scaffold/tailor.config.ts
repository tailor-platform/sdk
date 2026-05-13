// Author tailor.config.ts so that defineConfig() wires:
//   - two defineIdp instances: "staff-idp" (clients: ["staff-portal"]) and
//     "customer-idp" (clients: ["customer-app"]), both using
//     unsafeAllowAllIdPPermission.
//   - a single defineAuth("my-auth", { ... }) whose idProvider comes from
//     staffIdp.provider("primary", "staff-portal").
//   - defineConfig: { name: "micro-challenge", idp: [staffIdp, customerIdp],
//     auth, db: { tailordb: { files: ["./tailordb/*.ts"] } } }
// See problem.md for the full requirements.
