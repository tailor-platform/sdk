// Define and export `post` as a TailorDB type named "Post" with `title` and
// `authorId` fields. The `authorId` field carries a many-to-one relation
// toward the imported `author` model, with the inverse handle named "posts"
// and the source-side handle named "author". See problem.md for the full
// requirements.
import { author } from "./author";

// Reference the imported model so the file does not fail to typecheck before
// you wire it into the relation builder.
void author;
