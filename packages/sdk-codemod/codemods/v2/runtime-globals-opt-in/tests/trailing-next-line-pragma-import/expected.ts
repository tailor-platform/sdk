import "@tailor-platform/sdk/runtime/globals";
import value from "pkg"; // @ts-expect-error
const client = new tailor.idp.Client(value);
