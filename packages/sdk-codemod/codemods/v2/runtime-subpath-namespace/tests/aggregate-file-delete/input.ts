import { file as runtimeFile } from "@tailor-platform/sdk/runtime";

await runtimeFile.deleteFile("ns", "Doc", "blob", "rec-1");
await runtimeFile["deleteFile"]("ns", "Doc", "blob", "rec-2");

function remove(runtimeFile: { deleteFile(): void }) {
  runtimeFile.deleteFile();
}

const callback = function runtimeFile() {
  runtimeFile.deleteFile();
};

const RuntimeFile = class runtimeFile {
  remove() {
    runtimeFile.deleteFile();
  }
};

const localFile = {
  deleteFile() {},
};
localFile.deleteFile();
