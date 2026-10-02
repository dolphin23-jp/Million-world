import { defineConfig } from 'vite';

// GitHub Pages: https://dolphin23-jp.github.io/million-world/
export default defineConfig({
  base: '/million-world/',
  server: {
    host: true,
    port: 5173,
  },
  preview: {
    port: 4173,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    chunkSizeWarningLimit: 1200,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
