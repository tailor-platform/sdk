import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "client",
  base: "/",
  plugins: [react()],
  build: {
    outDir: "../dist/client",
    emptyOutDir: true,
    rolldownOptions: {
      input: { index: "client/index.html", "function-run": "client/function-run.html" },
    },
  },
});
