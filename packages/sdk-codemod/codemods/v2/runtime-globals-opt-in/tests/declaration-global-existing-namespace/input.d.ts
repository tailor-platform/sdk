export {};

declare global {
  namespace tailor {
    namespace idp {
      type User = string;
    }
  }
}

type RuntimeUser = tailor.idp.User;
