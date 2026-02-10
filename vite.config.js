import { defineConfig } from 'vite';
import { resolve } from 'path';
import { copyFileSync, mkdirSync, existsSync } from 'fs';

// Plugin to copy static files that Vite doesn't process
function copyStaticFiles() {
  const files = ['script.js', 'sw.js', 'manifest.json', 'config.js'];
  return {
    name: 'copy-static-files',
    closeBundle() {
      const destDir = resolve(__dirname, 'dist');
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      for (const file of files) {
        const src = resolve(__dirname, file);
        if (existsSync(src)) {
          copyFileSync(src, resolve(destDir, file));
        }
      }
    },
  };
}

export default defineConfig({
  root: '.',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        dashboard: resolve(__dirname, 'dashboard.html'),
        game: resolve(__dirname, 'game.html'),
        league: resolve(__dirname, 'league.html'),
        tournament: resolve(__dirname, 'tournament.html'),
      },
    },
  },
  plugins: [copyStaticFiles()],
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
});
