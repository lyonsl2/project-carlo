import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { copyFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import type { Plugin } from "vite";

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
  plugins: [react(), copySqlWasm()],
  server: {
    host: true,
    port: 5173,
  },
});
