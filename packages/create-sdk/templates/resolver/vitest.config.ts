import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    watch: false,
    projects: [
      {
        test: {
          name: { label: "unit", color: "blue" },
          include: ["src/**/*.test.ts"],
        },
      },
      {
        test: {
          name: { label: "bundled", color: "yellow" },
          include: ["tests/**/*.test.ts"],
        },
      },
    ],
  },
});
