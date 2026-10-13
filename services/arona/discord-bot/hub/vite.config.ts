import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// 開発時は bot 側 (PORT=8091) に API と OAuth を中継する
export default defineConfig({
  root: "web",
  plugins: [react()],
  build: { outDir: "dist", emptyOutDir: true },
  server: {
    proxy: {
      "/api": "http://localhost:8091",
      "/auth": "http://localhost:8091",
    },
  },
});
