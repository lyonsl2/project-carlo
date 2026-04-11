import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

import { cloudflare } from "@cloudflare/vite-plugin";

function copySqlWasm(): Plugin {
  return {
    name: "copy-sql-wasm",
    buildStart() {
      const srcDir = resolve(__dirname, "node_modules/sql.js/dist");
      const destDir = resolve(__dirname, "public");
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      for (const f of readdirSync(srcDir)) {
        if (f.endsWith(".wasm")) {
          copyFileSync(resolve(srcDir, f), resolve(destDir, f));
        }
      }
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), copySqlWasm(), cloudflare()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          sql: ["sql.js"],
          map: ["leaflet", "react-leaflet"],
          vendor: ["react", "react-dom", "react-router-dom"],
        },
      },
    },
  },
  server: {
    host: true,
    port: 5173,
  },
});