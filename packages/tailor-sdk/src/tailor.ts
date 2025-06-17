let distPath: string = ".tailor-sdk";
export const getDistPath = () => distPath;

export const Tailor = {
  init: (path?: string) => {
    if (path) {
      distPath = path;
    }
    console.log("Tailor SDK initialized");
    console.log("path:", distPath);
  },
};
