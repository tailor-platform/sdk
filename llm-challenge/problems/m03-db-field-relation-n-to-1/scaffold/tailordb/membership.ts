// Define and export `membership` as a TailorDB type named "Membership" with a
// single `organizationId` UUID field that holds a many-to-one relation toward
// the `organization` model imported below. See problem.md for the full
// requirements.
import { organization } from "./organization";

// Reference the imported model so the file does not fail to typecheck before
// you wire it into the relation builder.
void organization;
