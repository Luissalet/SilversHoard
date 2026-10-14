import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// The app: client/index.html -> silvers_hoard/static (the playable page for friends is built by vite.play.config.js into static/play).
export default defineConfig({
  root: 'client',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../silvers_hoard/static',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1500,
    rollupOptions: { input: 'client/index.html' },
  },
  server: {
    host: '127.0.0.1',
    port: Number(process.env.VITE_PORT || 5173),
    proxy: {
      '/api': `http://127.0.0.1:${process.env.SILVER_PORT || process.env.PORT || 5206}`,
    },
  },
});
