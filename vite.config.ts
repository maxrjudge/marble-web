import { defineConfig } from 'vite';
export default defineConfig({
  root: 'web',
  build: { outDir: '../dist/public', emptyOutDir: true },
  server: { proxy: { '/api': 'http://127.0.0.1:5310', '/auth': 'http://127.0.0.1:5310', '/ws': { target: 'ws://127.0.0.1:5310', ws: true } } },
});
