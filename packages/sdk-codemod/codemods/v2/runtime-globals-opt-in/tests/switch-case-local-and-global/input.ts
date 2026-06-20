switch (kind) {
  case "local":
    const tailor = localClient;
    tailor.run();
    break;
}

const client = new tailor.idp.Client();

export { client };
