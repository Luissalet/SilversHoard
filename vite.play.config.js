import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';
import { packPlayPlugin } from './scripts/pack_play.mjs';

// The playable page for friends: client/play.html with the battle engine (Pokémon Showdown's simulator and the AI) inlined into one
// HTML file, silvers_hoard/static/play/play.html. The app fills its data slot when it exports a gym or a trainer.
// packPlayPlugin deflates the inlined script into a base64 block the page inflates when it opens (scripts/pack_play.mjs).
export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true }), packPlayPlugin()],
  build: {
    outDir: '../silvers_hoard/static/play',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
    rollupOptions: { input: 'client/play.html' },
  },
});
