import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// App is mounted at /admin. All bundled assets are emitted under /admin/assets
// so the gateway's /admin/assets/:file route can serve them from the dist
// folder without further rewrites.
export default defineConfig({
  base: "/admin/",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    assetsDir: "assets",
  },
  server: {
    port: 5174,
    proxy: {
      "/admin/api": "http://127.0.0.1:7830",
    },
  },
});
