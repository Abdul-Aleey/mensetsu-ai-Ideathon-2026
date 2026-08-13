import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Local dev: frontend runs on its own port and proxies /api to the FastAPI
// backend on :8080. In production (Docker/Cloud Run) both are one origin —
// see backend/server.py, which mounts the built dist/ as static files.
export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": "http://127.0.0.1:8080",
    },
  },
});
