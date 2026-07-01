import { auth } from "../tailor.config";

namespace auth {
  export const token = auth.getConnectionToken("google");
}

namespace box {
  import auth = other.auth;

  export const token = auth.getConnectionToken("github");
}
