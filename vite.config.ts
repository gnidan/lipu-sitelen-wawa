import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/lipu-sitelen-wawa/",
  plugins: [react()],
  build: {
    outDir: "dist",
  },
});
