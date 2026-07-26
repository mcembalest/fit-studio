import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  server: {
    port: 8080,
    // The Worker runs separately under `wrangler dev` on 8787; everything the
    // Worker owns in production is proxied to it in development.
    proxy: {
      "/api": { target: "http://localhost:8787", changeOrigin: true },
      "/img": { target: "http://localhost:8787", changeOrigin: true },
    },
  },
  plugins: [react()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
