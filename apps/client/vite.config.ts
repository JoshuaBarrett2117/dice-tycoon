import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  base: './',
  resolve: {
    alias: { '@dt/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) },
  },
  server: { port: 5173 },
  build: { target: 'es2020', chunkSizeWarningLimit: 1200 },
});
