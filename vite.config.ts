import { defineConfig } from 'vite';

// 配信先でパスの基点が変わる:
//   GitHub Pages (project site): BASE_PATH=/Million-world/  （.github/workflows/deploy.yml が設定）
//   Vercel / Cloudflare Pages / ローカル preview: 既定の '/'
const base = process.env.BASE_PATH ?? '/';

export default defineConfig({
  base,
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
