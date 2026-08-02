import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The API client calls /api by default, so the dev server proxies that prefix to the backend and
// strips it: the browser, the proxy, and a production reverse proxy all agree on one public path.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (path: string) => path.replace(/^\/api/, ""),
      },
    },
  },
  build: {
    outDir: "dist",
    sourcemap: true,
  },
});
