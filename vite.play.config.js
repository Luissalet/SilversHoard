import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// The playable page for friends: client/play.html with the battle engine (Pokémon Showdown's simulator and the AI) inlined into one
// HTML file, silvers_hoard/static/play/play.html. The app fills its data slot when it exports a gym or a trainer.
export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss(), viteSingleFile({ removeViteModuleLoader: true })],
  build: {
    outDir: '../silvers_hoard/static/play',
    emptyOutDir: true,
    chunkSizeWarningLimit: 20000,
    rollupOptions: { input: 'client/play.html' },
  },
});
