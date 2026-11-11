import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  root: fileURLToPath(new URL("./client/friends", import.meta.url)),
  base: "./",
  plugins: [react(), tailwindcss()],
  esbuild: { keepNames: true },
  build: {
    outDir: fileURLToPath(new URL("./dist/friends", import.meta.url)),
    emptyOutDir: true,
    rollupOptions: {
      input: ["index.html", "amigos/index.html", "combate/index.html"].map((path) =>
        fileURLToPath(new URL(`./client/friends/${path}`, import.meta.url))),
    },
  },
});
